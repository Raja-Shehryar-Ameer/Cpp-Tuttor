"""Crash classification and failure messaging — no live GDB or Docker."""

from __future__ import annotations

import subprocess
from pathlib import Path

from app.core.config import Settings
from app.models.trace import TraceStatus
from app.services.gdb_driver import GdbSessionError, GdbTimeout, _parse_stop
from app.services.sandbox import SandboxRunner
from app.services.trace_service import TraceService, WallClockTimeout


# ---- MI stop parsing ------------------------------------------------------


def test_exited_signalled_is_a_crash_not_an_exit():
    stop = _parse_stop({"reason": "exited-signalled", "signal-name": "SIGKILL"})
    assert stop.reason == "signal"
    assert stop.signal_name == "SIGKILL"


def test_normal_exit_still_parses_octal_code():
    stop = _parse_stop({"reason": "exited", "exit-code": "011"})
    assert stop.reason == "exited"
    assert stop.exit_code == 9


def test_signal_received_unchanged():
    stop = _parse_stop({"reason": "signal-received", "signal-name": "SIGSEGV"})
    assert stop.reason == "signal"
    assert stop.signal_name == "SIGSEGV"


# ---- stack-overflow classification ---------------------------------------


class _EvalSession:
    """Only what _looks_like_stack_overflow touches: evaluate()."""

    def __init__(self, values: dict[str, str] | None = None):
        self._values = values or {}

    def evaluate(self, expr: str) -> str:
        if expr not in self._values:
            raise GdbSessionError(f"no recorded value for {expr!r}")
        return self._values[expr]


_SI_ADDR = "(unsigned long long)$_siginfo._sifields._sigfault.si_addr"
_SP = "(unsigned long long)$sp"


def test_deep_stack_is_overflow_without_siginfo():
    assert TraceService._looks_like_stack_overflow(_EvalSession(), depth=300)
    assert TraceService._looks_like_stack_overflow(_EvalSession(), depth=512)


def test_fault_on_guard_page_is_overflow_even_when_shallow():
    # one huge local array: fault lands just below $sp at depth 1
    session = _EvalSession({_SI_ADDR: str(0x7FFD_0000_0000 - 4096), _SP: str(0x7FFD_0000_0000)})
    assert TraceService._looks_like_stack_overflow(session, depth=1)


def test_null_deref_is_not_overflow():
    session = _EvalSession({_SI_ADDR: "0", _SP: str(0x7FFD_0000_0000)})
    assert not TraceService._looks_like_stack_overflow(session, depth=2)


def test_far_fault_is_not_overflow():
    session = _EvalSession({_SI_ADDR: str(0x1000), _SP: str(0x7FFD_0000_0000)})
    assert not TraceService._looks_like_stack_overflow(session, depth=5)


def test_unreadable_siginfo_falls_back_to_plain_segfault():
    assert not TraceService._looks_like_stack_overflow(_EvalSession(), depth=1)
    garbage = _EvalSession({_SI_ADDR: "(void *) 0x7f??", _SP: "nonsense"})
    assert not TraceService._looks_like_stack_overflow(garbage, depth=1)


# ---- timeout message split ------------------------------------------------


class _FakeCompiler:
    def compile(self, source: Path, out_dir: Path) -> Path:
        return out_dir / "prog"


class _InertSession:
    def __init__(self, *args):
        pass

    def stop(self) -> None:
        pass


def _timeout_trace(tmp_path: Path, monkeypatch, exc: Exception):
    (tmp_path / "main.cpp").write_text("int main() {}\n")
    service = TraceService(_FakeCompiler(), lambda *a: _InertSession(), Settings())

    def boom(*args, **kwargs):
        raise exc

    monkeypatch.setattr(TraceService, "_run_loop", boom)
    return service.trace(tmp_path)


def test_wall_clock_timeout_blames_the_infinite_loop(tmp_path, monkeypatch):
    trace = _timeout_trace(tmp_path, monkeypatch, WallClockTimeout("wall"))
    assert trace.status == TraceStatus.TIMEOUT
    assert "looping forever" in trace.error


def test_stuck_op_timeout_mentions_input_and_loop_exit(tmp_path, monkeypatch):
    trace = _timeout_trace(tmp_path, monkeypatch, GdbTimeout("no result"))
    assert trace.status == TraceStatus.TIMEOUT
    assert "stdin" in trace.error


# ---- sandbox OOM heuristic ------------------------------------------------


def _run_with_result(monkeypatch, returncode: int, stdout: str = "not json"):
    def fake_run(*args, **kwargs):
        return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)
    return SandboxRunner(Settings()).run("int main() {}", "")


def test_container_killed_at_137_reports_oom(monkeypatch):
    trace = _run_with_result(monkeypatch, 137)
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "out of memory" in trace.error


def test_other_garbage_output_keeps_generic_message(monkeypatch):
    trace = _run_with_result(monkeypatch, 1)
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "no usable output" in trace.error
