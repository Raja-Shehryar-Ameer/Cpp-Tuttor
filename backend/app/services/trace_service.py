"""Orchestrates one GDB session into a Trace: step loop + TraceBuilder."""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

from app.core.config import Settings
from app.models.trace import Frame, Step, StepEvent, Trace, TraceStatus
from app.services.compile_service import CompileError, CompileService
from app.services.gdb_driver import GdbSession, GdbSessionError, GdbTimeout, StopInfo
from app.services.heap_tracker import HeapTracker
from app.services.value_parser import parse_value

_SIGNAL_MESSAGES = {
    "SIGSEGV": "segmentation fault — the program accessed invalid memory",
    "SIGFPE": "arithmetic error (for example division by zero)",
    "SIGABRT": "the program aborted",
    "SIGBUS": "invalid memory access (bus error)",
    "SIGKILL": "the program was killed — almost certainly it ran out of memory (256 MB limit)",
    "SIGILL": "illegal instruction — execution jumped into data or corrupted code",
    "SIGTRAP": "hit a debug trap",
    "SIGSYS": "made a system call the sandbox does not allow",
}
_MAX_BAILOUTS = 200
# SIGSEGV classification: this deep almost certainly means runaway recursion…
_STACK_OVERFLOW_DEPTH = 300
# …and a fault this close to $sp means the stack guard page, however shallow
# the stack is (one huge local array can overflow from main directly).
_STACK_GUARD_BYTES = 1 << 20
# Snapshotting hundreds of frames is slow and tells the student nothing new.
_CRASH_SNAPSHOT_FRAMES = 20


class WallClockTimeout(GdbTimeout):
    """Our own wall-clock budget ran out (vs. one MI operation getting stuck)."""


class TraceBuilder:
    """Builder: accumulates steps, enforces the step limit, finalizes status."""

    def __init__(self, source_code: str, max_steps: int):
        self._source = source_code
        self._max_steps = max_steps
        self._steps: list[Step] = []
        self._status = TraceStatus.OK
        self._error: str | None = None

    @property
    def last_step(self) -> Step | None:
        return self._steps[-1] if self._steps else None

    def add(self, step: Step) -> bool:
        """Append a step; returns False once the step limit is hit."""
        if len(self._steps) >= self._max_steps:
            self.fail(
                TraceStatus.STEP_LIMIT,
                f"Execution stopped after {self._max_steps} steps (limit reached).",
            )
            return False
        self._steps.append(step)
        return True

    def fail(self, status: TraceStatus, error: str) -> None:
        self._status = status
        self._error = error

    def build(self) -> Trace:
        return Trace(
            status=self._status, error=self._error, sourceCode=self._source, steps=self._steps
        )


class TraceService:
    """Dependency-injected: pass fakes for the compiler / GDB factory in tests."""

    def __init__(
        self,
        compiler: CompileService,
        gdb_factory: Callable[..., GdbSession],
        settings: Settings,
    ):
        self._compiler = compiler
        self._gdb_factory = gdb_factory
        self._settings = settings

    def trace(self, work_dir: Path, source_name: str = "main.cpp") -> Trace:
        source_path = work_dir / source_name
        # Per-trace state for declaration-gated variable visibility.
        self._decl_cache: dict[str, dict[str, int]] = {}
        self._progress: list[list] = []  # bottom-up [functionName, max executed line]
        builder = TraceBuilder(source_path.read_text(), self._settings.max_steps)
        try:
            binary = self._compiler.compile(source_path, work_dir)
        except CompileError as exc:
            builder.fail(TraceStatus.COMPILE_ERROR, exc.message)
            return builder.build()

        session = self._gdb_factory(str(binary), self._settings.wall_timeout_s)
        try:
            self._run_loop(session, builder, source_path, work_dir)
        except WallClockTimeout:
            builder.fail(
                TraceStatus.TIMEOUT,
                f"The program ran longer than {self._settings.wall_timeout_s} s — it is "
                "probably looping forever. The steps captured before the cutoff are playable.",
            )
        except GdbTimeout:
            builder.fail(
                TraceStatus.TIMEOUT,
                "The program stopped making progress — most likely a loop stuck on one "
                "line, or a read waiting for input that never arrives. Check the loop's "
                "exit condition, or fill the stdin box and run again.",
            )
        except GdbSessionError as exc:
            builder.fail(TraceStatus.RUNTIME_ERROR, f"The debugger failed: {exc}")
        finally:
            session.stop()
        return builder.build()

    # ---- the step loop ----------------------------------------------------

    def _run_loop(
        self, session: GdbSession, builder: TraceBuilder, source_path: Path, work_dir: Path
    ) -> None:
        stdout_path = work_dir / "stdout.txt"
        deadline = time.monotonic() + self._settings.wall_timeout_s

        session.start()
        session.set_breakpoint("main")
        stop = session.run(str(work_dir / "stdin.txt"), str(stdout_path))
        heap = HeapTracker(source_path)
        heap.install(session)

        prev_depth = 0
        prev_line: int | None = None
        bailouts = 0
        while True:
            if time.monotonic() > deadline:
                raise WallClockTimeout("wall-clock limit reached")
            stop = heap.resolve(session, stop)

            if stop.reason == "exited":
                self._append_exit(builder, stdout_path)
                return
            if stop.reason == "signal":
                self._append_crash(session, builder, heap, stop, source_path, stdout_path)
                return

            if stop.file != str(source_path):
                # Inside library/header code: unwind back to user code.
                bailouts += 1
                if bailouts > _MAX_BAILOUTS:
                    raise GdbSessionError("could not return to user code")
                stop = self._bail_out(session)
                continue
            bailouts = 0

            frames = session.get_stack()
            depth = len(frames)
            # Re-stops on the same line mid-statement add noise, not information.
            if stop.line != prev_line or depth != prev_depth:
                event = self._classify(builder, depth, prev_depth)
                stack = self._snapshot_stack(session, frames, source_path)
                step = Step(
                    line=stop.line or 0,
                    event=event,
                    functionName=stop.function or "?",
                    stdout=self._read_stdout(stdout_path),
                    stack=stack,
                    heap=heap.snapshot(session, stack),
                )
                if not builder.add(step):
                    return
                prev_line, prev_depth = stop.line, depth
            stop = session.step()

    def _bail_out(self, session: GdbSession) -> StopInfo:
        try:
            return session.finish()
        except GdbTimeout:
            raise
        except GdbSessionError:
            return session.next()

    @staticmethod
    def _classify(builder: TraceBuilder, depth: int, prev_depth: int) -> StepEvent:
        if builder.last_step is None or depth > prev_depth:
            return StepEvent.CALL
        if depth < prev_depth:
            return StepEvent.RETURN
        return StepEvent.STEP

    # ---- snapshots ----------------------------------------------------------

    def _snapshot_stack(
        self, session: GdbSession, frames: list[dict], source_path: Path
    ) -> list[Frame]:
        user = [raw for raw in frames if raw.get("fullname") == str(source_path)]
        self._update_progress(user)
        stack: list[Frame] = []
        for i, raw in enumerate(user):  # innermost first
            level = int(raw["level"])
            func = raw.get("func", "?")
            variables = session.get_locals(level)
            if func not in self._decl_cache:
                self._decl_cache[func] = session.get_decl_lines()
            decls = self._decl_cache[func]
            reached = self._progress[len(user) - 1 - i][1]
            locals_ = [
                parse_value(var["name"], var.get("type", ""), var["name"], session)
                for var in variables
                # A variable exists for the diagram only once execution has
                # moved past its declaration line in this frame instance.
                if reached > decls.get(var["name"], 0)
            ]
            stack.append(
                Frame(
                    # Numbered from the bottom so main is always f0: keys stay
                    # stable across steps and the UI animates only real calls.
                    frameId=f"f{len(user) - 1 - i}",
                    functionName=func,
                    line=int(raw.get("line", 0)),
                    locals=locals_,
                )
            )
        return stack

    def _update_progress(self, user_frames: list[dict]) -> None:
        """Track the deepest line each live frame has executed (bottom-up)."""
        bottom_up = list(reversed(user_frames))
        del self._progress[len(bottom_up):]
        for i, raw in enumerate(bottom_up):
            func, line = raw.get("func", "?"), int(raw.get("line", 0))
            if i < len(self._progress) and self._progress[i][0] == func:
                self._progress[i][1] = max(self._progress[i][1], line)
            elif i < len(self._progress):
                self._progress[i] = [func, line]
            else:
                self._progress.append([func, line])

    def _read_stdout(self, stdout_path: Path) -> str:
        try:
            data = stdout_path.read_bytes()
        except OSError:
            return ""
        limit = self._settings.output_limit_bytes
        text = data[:limit].decode("utf-8", errors="replace")
        if len(data) > limit:
            text += "\n…[output truncated]"
        return text

    # ---- terminal steps -----------------------------------------------------

    def _append_exit(self, builder: TraceBuilder, stdout_path: Path) -> None:
        last = builder.last_step
        builder.add(
            Step(
                line=last.line if last else 0,
                event=StepEvent.EXIT,
                functionName=last.functionName if last else "main",
                stdout=self._read_stdout(stdout_path),
                stack=[],
                heap=last.heap if last else [],
            )
        )

    def _append_crash(
        self,
        session: GdbSession,
        builder: TraceBuilder,
        heap: HeapTracker,
        stop: StopInfo,
        source_path: Path,
        stdout_path: Path,
    ) -> None:
        # Classify before snapshotting: _snapshot_stack selects outer frames,
        # and $sp follows the selected frame — reading it afterwards would
        # compare the fault address against main's sp instead of the crash's.
        overflow = False
        depth = 0
        try:
            depth = session.stack_depth()
            overflow = stop.signal_name == "SIGSEGV" and self._looks_like_stack_overflow(
                session, depth
            )
            frames = session.get_stack(
                max_frames=_CRASH_SNAPSHOT_FRAMES if depth > _CRASH_SNAPSHOT_FRAMES else None
            )
            stack = self._snapshot_stack(session, frames, source_path)
            heap_objects = heap.snapshot(session, stack)
        except GdbSessionError:
            stack, heap_objects = [], []
        builder.add(
            Step(
                line=stop.line or (builder.last_step.line if builder.last_step else 0),
                event=StepEvent.EXCEPTION,
                functionName=stop.function or "?",
                stdout=self._read_stdout(stdout_path),
                stack=stack,
                heap=heap_objects,
            )
        )
        detail = _SIGNAL_MESSAGES.get(stop.signal_name or "", stop.signal_name or "a fatal signal")
        if overflow:
            detail = (
                "stack overflow — the call stack ran out of space (look for runaway "
                "recursion with a missing base case, or a huge local array)"
            )
        builder.fail(TraceStatus.RUNTIME_ERROR, f"Program crashed: {detail}.")

    @staticmethod
    def _looks_like_stack_overflow(session: GdbSession, depth: int) -> bool:
        if depth >= _STACK_OVERFLOW_DEPTH:
            return True
        # Shallow-stack overflows (one giant local array) fault on the guard
        # page, so the faulting address sits just past the stack pointer.
        try:
            fault = int(
                session.evaluate("(unsigned long long)$_siginfo._sifields._sigfault.si_addr"), 0
            )
            sp = int(session.evaluate("(unsigned long long)$sp"), 0)
        except (GdbSessionError, TypeError, ValueError):
            return False
        return fault != 0 and abs(fault - sp) < _STACK_GUARD_BYTES
