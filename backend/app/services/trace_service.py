"""Orchestrates one GDB session into a Trace: step loop + TraceBuilder."""

from __future__ import annotations

import time
from collections.abc import Callable
from pathlib import Path

from app.core.config import Settings
from app.models.trace import Frame, HeapObject, Step, StepEvent, Trace, TraceStatus
from app.services.compile_service import CompileError, CompileService
from app.services.gdb_driver import GdbSession, GdbSessionError, GdbTimeout, StopInfo
from app.services.value_parser import parse_value

_SIGNAL_MESSAGES = {
    "SIGSEGV": "segmentation fault — the program accessed invalid memory",
    "SIGFPE": "arithmetic error (for example division by zero)",
    "SIGABRT": "the program aborted",
    "SIGBUS": "invalid memory access (bus error)",
}
_MAX_BAILOUTS = 200


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

    def trace(self, work_dir: Path) -> Trace:
        source_path = work_dir / "main.cpp"
        builder = TraceBuilder(source_path.read_text(), self._settings.max_steps)
        try:
            binary = self._compiler.compile(source_path, work_dir)
        except CompileError as exc:
            builder.fail(TraceStatus.COMPILE_ERROR, exc.message)
            return builder.build()

        session = self._gdb_factory(str(binary), self._settings.wall_timeout_s)
        try:
            self._run_loop(session, builder, source_path, work_dir)
        except GdbTimeout:
            builder.fail(
                TraceStatus.TIMEOUT,
                f"Program took longer than {self._settings.wall_timeout_s}s "
                "(is it waiting for input or looping forever?).",
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

        prev_depth = 0
        prev_line: int | None = None
        bailouts = 0
        while True:
            if time.monotonic() > deadline:
                raise GdbTimeout("wall-clock limit reached")

            if stop.reason == "exited":
                self._append_exit(builder, stdout_path)
                return
            if stop.reason == "signal":
                self._append_crash(session, builder, stop, source_path, stdout_path)
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
                step = Step(
                    line=stop.line or 0,
                    event=event,
                    functionName=stop.function or "?",
                    stdout=self._read_stdout(stdout_path),
                    stack=self._snapshot_stack(session, frames, source_path),
                    heap=self._snapshot_heap(),
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
        stack: list[Frame] = []
        for raw in frames:
            if raw.get("fullname") != str(source_path):
                continue
            level = int(raw["level"])
            locals_ = [
                parse_value(var["name"], var.get("type", ""), var["name"], session)
                for var in session.get_locals(level)
            ]
            stack.append(
                Frame(
                    frameId=f"f{len(stack)}",
                    functionName=raw.get("func", "?"),
                    line=int(raw.get("line", 0)),
                    locals=locals_,
                )
            )
        return stack

    def _snapshot_heap(self) -> list[HeapObject]:
        # Heap tracking arrives with Phase 2 (allocator breakpoints).
        return []

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
                heap=self._snapshot_heap(),
            )
        )

    def _append_crash(
        self,
        session: GdbSession,
        builder: TraceBuilder,
        stop: StopInfo,
        source_path: Path,
        stdout_path: Path,
    ) -> None:
        try:
            stack = self._snapshot_stack(session, session.get_stack(), source_path)
        except GdbSessionError:
            stack = []
        builder.add(
            Step(
                line=stop.line or (builder.last_step.line if builder.last_step else 0),
                event=StepEvent.EXCEPTION,
                functionName=stop.function or "?",
                stdout=self._read_stdout(stdout_path),
                stack=stack,
                heap=self._snapshot_heap(),
            )
        )
        detail = _SIGNAL_MESSAGES.get(stop.signal_name or "", stop.signal_name or "a fatal signal")
        builder.fail(TraceStatus.RUNTIME_ERROR, f"Program crashed: {detail}.")
