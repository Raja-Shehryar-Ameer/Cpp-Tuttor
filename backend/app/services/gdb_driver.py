"""Facade over pygdbmi. Nothing outside this file touches GDB/MI records.

GdbSession also satisfies value_parser.EvalContext, so parsers can evaluate
expressions without knowing GDB exists.
"""

from __future__ import annotations

import contextlib
import time
from dataclasses import dataclass

from pygdbmi.gdbcontroller import GdbController

from app.services.value_parser.base import EvalError, extract_address


class GdbSessionError(EvalError):
    """An MI command failed."""


class GdbTimeout(GdbSessionError):
    """GDB did not respond in time (e.g. the program blocks on cin)."""


@dataclass
class StopInfo:
    # reason: "breakpoint-hit" | "end-stepping-range" | "function-finished" | "exited" | "signal"
    reason: str
    line: int | None = None
    function: str | None = None
    file: str | None = None
    exit_code: int | None = None
    signal_name: str | None = None


class GdbSession:
    def __init__(self, binary: str, op_timeout_s: float = 10.0):
        self._timeout = op_timeout_s
        # Default 0.2s "wait for more output" makes every MI op glacial;
        # _cmd/_exec re-poll for missing records themselves.
        self._gdb: GdbController | None = GdbController(
            command=["gdb", "--nx", "--quiet", "--interpreter=mi3", binary],
            time_to_check_for_additional_output_sec=0.001,
        )
        self._varobj_seq = 0

    # ---- lifecycle -------------------------------------------------------

    def start(self) -> None:
        self._cmd("-gdb-set confirm off")
        self._cmd("-gdb-set print elements 200")
        # Docker's default seccomp profile blocks the personality() syscall.
        self._cmd("-gdb-set disable-randomization off")
        self._cmd("-enable-pretty-printing")
        # Never step into system headers/libraries; keeps the loop in user code.
        self._cmd('-interpreter-exec console "skip -gfi /usr/**/*"')

    def set_breakpoint(self, location: str) -> None:
        self._cmd(f"-break-insert {location}")

    def run(self, stdin_path: str, stdout_path: str) -> StopInfo:
        # Redirection is a shell feature, so it must go through the console interpreter.
        return self._exec(f'-interpreter-exec console "run < {stdin_path} > {stdout_path}"')

    def stop(self) -> None:
        if self._gdb is not None:
            self._gdb.exit()
            self._gdb = None

    # ---- execution -------------------------------------------------------

    def step(self) -> StopInfo:
        return self._exec("-exec-step")

    def next(self) -> StopInfo:
        return self._exec("-exec-next")

    def finish(self) -> StopInfo:
        return self._exec("-exec-finish")

    def cont(self) -> StopInfo:
        return self._exec("-exec-continue")

    # ---- inspection ------------------------------------------------------

    def get_stack(self) -> list[dict]:
        payload = self._cmd("-stack-list-frames")
        return [f.get("frame", f) for f in _as_list(payload.get("stack", []))]

    def select_frame(self, level: int) -> None:
        self._cmd(f"-stack-select-frame {level}")

    def get_locals(self, level: int) -> list[dict]:
        """Names and types of locals + args in the given frame; selects that frame."""
        self.select_frame(level)
        payload = self._cmd("-stack-list-variables --simple-values")
        return _as_list(payload.get("variables", []))

    # ---- EvalContext implementation --------------------------------------

    def evaluate(self, expr: str) -> str:
        escaped = expr.replace('"', '\\"')
        payload = self._cmd(f'-data-evaluate-expression "{escaped}"')
        return payload.get("value", "")

    def address_of(self, expr: str) -> str | None:
        try:
            return extract_address(self.evaluate(f"&({expr})"))
        except GdbSessionError:
            return None

    def children_of(self, expr: str) -> list[tuple[str, str]]:
        """Field (name, type) pairs of an aggregate, via a throwaway varobj."""
        name = f"cpptutor_v{self._varobj_seq}"
        self._varobj_seq += 1
        escaped = expr.replace('"', '\\"')
        self._cmd(f'-var-create {name} * "{escaped}"')
        try:
            return self._list_children(name)
        finally:
            with contextlib.suppress(GdbSessionError):
                self._cmd(f"-var-delete {name}")

    def _list_children(self, varobj: str) -> list[tuple[str, str]]:
        payload = self._cmd(f"-var-list-children --simple-values {varobj}")
        fields: list[tuple[str, str]] = []
        for child in _as_list(payload.get("children", [])):
            child = child.get("child", child)
            exp, ctype = child.get("exp", ""), child.get("type", "")
            # C++ access specifiers appear as pseudo-children; flatten them.
            if exp in ("public", "private", "protected"):
                fields.extend(self._list_children(child["name"]))
            else:
                fields.append((exp, ctype))
        return fields

    # ---- MI plumbing ------------------------------------------------------

    def _write(self, command: str) -> list[dict]:
        assert self._gdb is not None, "session is closed"
        return self._gdb.write(command, timeout_sec=self._timeout, raise_error_on_timeout=False)

    def _read_more(self) -> list[dict]:
        assert self._gdb is not None, "session is closed"
        return self._gdb.get_gdb_response(timeout_sec=0.3, raise_error_on_timeout=False)

    def _cmd(self, command: str) -> dict:
        """Run a synchronous MI command, return its result payload."""
        records = self._write(command)
        deadline = time.monotonic() + self._timeout
        while True:
            for rec in records:
                if rec["type"] == "result":
                    if rec["message"] == "error":
                        raise GdbSessionError(_error_msg(rec))
                    return rec.get("payload") or {}
            if time.monotonic() > deadline:
                raise GdbTimeout(f"no result for: {command}")
            records = self._read_more()

    def _exec(self, command: str) -> StopInfo:
        """Run an execution command and wait for the *stopped notification."""
        records = self._write(command)
        deadline = time.monotonic() + self._timeout
        while True:
            for rec in records:
                if rec["type"] == "result" and rec["message"] == "error":
                    raise GdbSessionError(_error_msg(rec))
                if rec["type"] == "notify" and rec["message"] == "stopped":
                    return _parse_stop(rec.get("payload") or {})
            if time.monotonic() > deadline:
                raise GdbTimeout(f"program did not stop after: {command}")
            records = self._read_more()


def _error_msg(record: dict) -> str:
    payload = record.get("payload") or {}
    return payload.get("msg", "unknown GDB error")


def _as_list(value: object) -> list[dict]:
    # MI sometimes yields a single dict where a list is expected.
    if isinstance(value, dict):
        return [value]
    return list(value) if isinstance(value, list) else []


def _parse_stop(payload: dict) -> StopInfo:
    reason = payload.get("reason", "unknown")
    frame = payload.get("frame") or {}
    info = StopInfo(
        reason=reason,
        line=int(frame["line"]) if "line" in frame else None,
        function=frame.get("func"),
        file=frame.get("fullname") or frame.get("file"),
    )
    if reason.startswith("exited"):
        info.reason = "exited"
        # MI reports the inferior's exit code in octal.
        info.exit_code = int(payload.get("exit-code", "0"), 8)
    elif reason == "signal-received":
        info.reason = "signal"
        info.signal_name = payload.get("signal-name")
    return info
