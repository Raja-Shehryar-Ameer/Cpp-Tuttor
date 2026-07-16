"""In-process Python tracer: sys.settrace → the same schema-v1 Trace GDB emits.

No GDB, no compiler — the sandbox container is the security boundary, exactly
as for C/C++ (network-none, read-only, memory/pids limits). The mapping onto
the C++-shaped schema:

    int/float/bool/None      → primitive
    str                      → string
    list/tuple               → heap array (locals hold a pointer to it)
    set/frozenset            → heap array, elements sorted for determinism
    dict                     → heap struct, one field per repr(key)
    object with __dict__     → heap struct labelled with the class name
    functions/classes        → primitive "<function f>" / "<class C>"

References use the synthetic address 0x{id(obj):x}; two names bound to the
same object share it, so the diagram draws aliasing arrows for free.
"""

from __future__ import annotations

import io
import signal
import sys
import threading
import time
import types

from app.core.config import Settings
from app.models.trace import Frame, HeapObject, Step, StepEvent, Trace, TraceStatus, Value, ValueKind
from app.services.trace_service import TraceBuilder

_SOURCE_NAME = "main.py"
# Student programs recursing past this raise RecursionError — a teachable
# runtime_error long before the step limit would end the lesson.
_RECURSION_LIMIT = 256
# Containers nested deeper than this render as an opaque primitive.
_SNAPSHOT_DEPTH = 4
# Mirror GDB's `set print elements 200`.
_MAX_ELEMENTS = 200

_PRIMITIVES = (int, float, bool, complex, type(None))
_CALLABLES = (types.FunctionType, types.BuiltinFunctionType, types.MethodType, type)


class _StopTracing(BaseException):
    """Unwinds the student program once a limit hit; never shown to anyone."""


def trace_python(code: str, stdin_text: str, settings: Settings) -> Trace:
    return _PyTracer(code, stdin_text, settings).run()


class _PyTracer:
    def __init__(self, code: str, stdin_text: str, settings: Settings):
        self._code = code
        self._stdin_text = stdin_text
        self._settings = settings
        self._builder = TraceBuilder(code, settings.max_steps)
        self._stdout = io.StringIO()
        self._stdout_frozen: str | None = None
        self._deadline = time.monotonic() + settings.wall_timeout_s
        self._done = False

    # ---- lifecycle ---------------------------------------------------------

    def run(self) -> Trace:
        try:
            top = compile(self._code, _SOURCE_NAME, "exec")
        except SyntaxError as exc:
            self._builder.fail(
                TraceStatus.COMPILE_ERROR, f"{_SOURCE_NAME}:{exc.lineno}: {exc.msg}"
            )
            return self._builder.build()

        module_ns: dict = {"__name__": "__main__", "__builtins__": __builtins__}
        old_stdout, old_stdin = sys.stdout, sys.stdin
        old_limit = sys.getrecursionlimit()
        sys.stdout = self._stdout
        # A real byte-backed wrapper, not StringIO: programs that reach for
        # sys.stdin.buffer (or mix input() with .read()) must work too.
        sys.stdin = io.TextIOWrapper(
            io.BytesIO(self._stdin_text.encode("utf-8")), encoding="utf-8"
        )
        alarm_set = self._arm_alarm()
        try:
            sys.setrecursionlimit(_RECURSION_LIMIT + len(_inspect_stack_depth()))
            sys.settrace(self._trace_cb)
            exec(top, module_ns)  # noqa: S102 — the sandbox container is the boundary
        except _StopTracing:
            pass  # the builder already carries the timeout / step-limit verdict
        except SystemExit:
            self._append_exit()
        except BaseException as exc:  # noqa: BLE001 — every student crash lands here
            self._append_exception(exc)
        else:
            self._append_exit()
        finally:
            sys.settrace(None)
            sys.stdout, sys.stdin = old_stdout, old_stdin
            sys.setrecursionlimit(old_limit)
            if alarm_set:
                signal.alarm(0)
        return self._builder.build()

    def _arm_alarm(self) -> bool:
        """SIGALRM backstop for C-level loops the trace callback never sees
        (e.g. 10**10**8). Unix main thread only — unit tests run without it."""
        if not hasattr(signal, "SIGALRM") or threading.current_thread() is not threading.main_thread():
            return False

        def on_alarm(signum, frame):  # noqa: ARG001
            self._fail_timeout()
            raise _StopTracing()

        signal.signal(signal.SIGALRM, on_alarm)
        signal.alarm(self._settings.wall_timeout_s + 2)
        return True

    def _fail_timeout(self) -> None:
        self._builder.fail(
            TraceStatus.TIMEOUT,
            f"The program ran longer than {self._settings.wall_timeout_s} s — it is "
            "probably looping forever. The steps captured before the cutoff are playable.",
        )

    # ---- the trace callback --------------------------------------------------

    def _trace_cb(self, frame: types.FrameType, event: str, arg):  # noqa: ANN001
        if self._done or frame.f_code.co_filename != _SOURCE_NAME:
            return None
        if time.monotonic() > self._deadline:
            self._fail_timeout()
            self._halt()
        if event == "call":
            self._record(frame, StepEvent.CALL)
        elif event == "line":
            self._record(frame, StepEvent.STEP)
        elif event == "return":
            self._record(frame, StepEvent.RETURN)
        return self._trace_cb

    def _halt(self) -> None:
        # Stop tracing first: even if a bare `except:` in student code swallows
        # _StopTracing, no further steps get recorded.
        self._done = True
        sys.settrace(None)
        raise _StopTracing()

    def _record(self, frame: types.FrameType, event: StepEvent) -> None:
        stack, heap = self._snapshot(frame)
        step = Step(
            line=frame.f_lineno,
            event=event,
            functionName=_frame_name(frame),
            stdout=self._read_stdout(),
            stack=stack,
            heap=heap,
        )
        if not self._builder.add(step):
            self._halt()

    def _read_stdout(self) -> str:
        if self._stdout_frozen is not None:
            return self._stdout_frozen
        text = self._stdout.getvalue()
        limit = self._settings.output_limit_bytes
        if len(text.encode("utf-8", errors="replace")) > limit:
            clipped = text.encode("utf-8", errors="replace")[:limit].decode("utf-8", "replace")
            self._stdout_frozen = clipped + "\n…[output truncated]"
            return self._stdout_frozen
        return text

    # ---- terminal steps -------------------------------------------------------

    def _append_exit(self) -> None:
        last = self._builder.last_step
        self._builder.add(
            Step(
                line=last.line if last else 0,
                event=StepEvent.EXIT,
                functionName=last.functionName if last else "<module>",
                stdout=self._read_stdout(),
                stack=[],
                heap=last.heap if last else [],
            )
        )

    def _append_exception(self, exc: BaseException) -> None:
        tb = exc.__traceback__
        deepest: types.FrameType | None = None
        line = 0
        while tb is not None:
            if tb.tb_frame.f_code.co_filename == _SOURCE_NAME:
                deepest, line = tb.tb_frame, tb.tb_lineno
            tb = tb.tb_next
        if deepest is not None:
            stack, heap = self._snapshot(deepest)
        else:
            stack, heap = [], []
        self._builder.add(
            Step(
                line=line,
                event=StepEvent.EXCEPTION,
                functionName=_frame_name(deepest) if deepest else "?",
                stdout=self._read_stdout(),
                stack=stack,
                heap=heap,
            )
        )
        if isinstance(exc, EOFError):
            message = (
                "the program asked for more input than the stdin box provides — "
                "add the missing line(s) and run again"
            )
        else:
            message = str(exc) or "(no message)"
        self._builder.fail(
            TraceStatus.RUNTIME_ERROR, f"Program crashed: {type(exc).__name__}: {message}."
        )

    # ---- snapshots -------------------------------------------------------------

    def _snapshot(self, frame: types.FrameType) -> tuple[list[Frame], list[HeapObject]]:
        chain: list[types.FrameType] = []
        cursor: types.FrameType | None = frame
        while cursor is not None:
            if cursor.f_code.co_filename == _SOURCE_NAME:
                chain.append(cursor)  # innermost first, like the GDB path
            cursor = cursor.f_back
        heap: dict[str, HeapObject] = {}
        frames: list[Frame] = []
        for i, fr in enumerate(chain):
            locals_ = [
                self._value(name, obj, heap, 0)
                for name, obj in fr.f_locals.items()
                if not name.startswith("__") and not isinstance(obj, types.ModuleType)
            ]
            frames.append(
                Frame(
                    # f0 = the module frame, mirroring "main is always f0".
                    frameId=f"f{len(chain) - 1 - i}",
                    functionName=_frame_name(fr),
                    line=fr.f_lineno,
                    locals=locals_,
                )
            )
        return frames, list(heap.values())

    def _value(self, name: str, obj: object, heap: dict[str, HeapObject], depth: int) -> Value:
        type_name = type(obj).__name__
        if isinstance(obj, _PRIMITIVES):
            return Value(name=name, type=type_name, kind=ValueKind.PRIMITIVE, value=repr(obj))
        if isinstance(obj, str):
            return Value(name=name, type="str", kind=ValueKind.STRING, value=repr(obj))
        if isinstance(obj, _CALLABLES):
            label = "class" if isinstance(obj, type) else "function"
            short = getattr(obj, "__name__", type_name)
            return Value(
                name=name, type=type_name, kind=ValueKind.PRIMITIVE, value=f"<{label} {short}>"
            )
        if depth > _SNAPSHOT_DEPTH:
            return Value(name=name, type=type_name, kind=ValueKind.PRIMITIVE, value="…")
        address = self._heap_ref(obj, heap, depth)
        if address is None:  # something exotic (generator, file, …)
            return Value(name=name, type=type_name, kind=ValueKind.PRIMITIVE, value=repr(obj))
        return Value(
            name=name, type=type_name, kind=ValueKind.POINTER, value=address, target=address
        )

    def _heap_ref(self, obj: object, heap: dict[str, HeapObject], depth: int) -> str | None:
        address = f"0x{id(obj):x}"
        if address in heap:  # aliasing and cycles land here
            return address
        if isinstance(obj, (list, tuple)):
            kind, label = ValueKind.ARRAY, f"{type(obj).__name__}[{len(obj)}]"
            items = list(enumerate(obj))
            named = [(f"[{i}]", v) for i, v in items]
        elif isinstance(obj, (set, frozenset)):
            kind, label = ValueKind.ARRAY, f"{type(obj).__name__}[{len(obj)}]"
            # sets are unordered — sort for stable traces and goldens
            named = [(f"[{i}]", v) for i, v in enumerate(sorted(obj, key=repr))]
        elif isinstance(obj, dict):
            kind, label = ValueKind.STRUCT, f"dict[{len(obj)}]"
            named = [(_key_name(k), v) for k, v in obj.items()]
        elif isinstance(obj, types.ModuleType):
            return None  # a module inside a container: render its repr, not its namespace
        elif hasattr(obj, "__dict__"):
            kind, label = ValueKind.STRUCT, type(obj).__name__
            named = list(vars(obj).items())
        else:
            return None
        # Insert the placeholder before recursing so self-references resolve.
        entry = HeapObject(address=address, label=label, kind=kind, elements=[])
        heap[address] = entry
        shown = named[:_MAX_ELEMENTS]
        entry.elements = [self._value(n, v, heap, depth + 1) for n, v in shown]
        if len(named) > _MAX_ELEMENTS:
            entry.elements.append(
                Value(
                    name="…",
                    type="",
                    kind=ValueKind.PRIMITIVE,
                    value=f"+{len(named) - _MAX_ELEMENTS} more",
                )
            )
        return address


def _frame_name(frame: types.FrameType) -> str:
    return frame.f_code.co_name


def _key_name(key: object) -> str:
    # dict fields are named by their key's repr: {"a": 1} → field `'a'`
    return repr(key)


def _inspect_stack_depth() -> list:
    """Frames already on the interpreter stack before the student's code runs;
    the recursion limit must leave room for them plus the trace callback."""
    frames = []
    f = sys._getframe()
    while f is not None:
        frames.append(f)
        f = f.f_back
    return frames
