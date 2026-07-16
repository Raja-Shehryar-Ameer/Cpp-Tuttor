"""Facade over pygdbmi. Nothing outside this file touches GDB/MI records.

GdbSession also satisfies value_parser.EvalContext, so parsers can evaluate
expressions without knowing GDB exists.
"""

from __future__ import annotations

import contextlib
import json
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from pygdbmi.gdbcontroller import GdbController

from app.services.value_parser.base import EvalError, extract_address

# GDB user command printing {name: declaration line} for every symbol in
# scope of the selected frame. MI has no such query; the Python API does.
_DECL_HELPER = """\
import gdb, json


class CppTutorDecl(gdb.Command):
    def __init__(self):
        super().__init__("cpptutor-decl", gdb.COMMAND_USER)

    def invoke(self, arg, from_tty):
        decls = {}
        try:
            block = gdb.selected_frame().block()
        except Exception:
            block = None
        while block is not None and not block.is_global and not block.is_static:
            for sym in block:
                if sym.is_argument and sym.name not in decls:
                    decls[sym.name] = 0  # arguments are live from function entry
                elif sym.is_variable and sym.name not in decls:
                    decls[sym.name] = sym.line
            block = block.superblock
        print("CPPTUTOR_DECL " + json.dumps(decls))


CppTutorDecl()
"""
_DECL_MARKER = "CPPTUTOR_DECL "


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
    # populated when reason == "function-finished" and the callee returned a value
    return_value: str | None = None


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
        # Line-buffer the inferior's stdout so cout shows up step by step.
        self._cmd('-interpreter-exec console "set exec-wrapper stdbuf -oL"')
        helper = Path(tempfile.gettempdir()) / "cpptutor_decl.py"
        helper.write_text(_DECL_HELPER)
        self._cmd(f'-interpreter-exec console "source {helper}"')

    def set_breakpoint(self, location: str) -> None:
        # -f: allow pending breakpoints (e.g. allocator symbols in libstdc++).
        self._cmd(f'-break-insert -f "{location}"')

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

    def get_stack(self, max_frames: int | None = None) -> list[dict]:
        # A range keeps crash snapshots fast when the stack is hundreds of
        # frames deep (runaway recursion); plain listing everywhere else.
        suffix = f" 0 {max_frames - 1}" if max_frames else ""
        payload = self._cmd(f"-stack-list-frames{suffix}")
        return [f.get("frame", f) for f in _as_list(payload.get("stack", []))]

    def stack_depth(self, cap: int = 512) -> int:
        """Current frame count, counting no further than `cap`."""
        payload = self._cmd(f"-stack-info-depth {cap}")
        return int(payload.get("depth", 0))

    def select_frame(self, level: int) -> None:
        self._cmd(f"-stack-select-frame {level}")

    def get_locals(self, level: int) -> list[dict]:
        """Names and types of locals + args in the given frame; selects that frame."""
        self.select_frame(level)
        payload = self._cmd("-stack-list-variables --simple-values")
        return _as_list(payload.get("variables", []))

    def get_decl_lines(self) -> dict[str, int]:
        """{variable: declaration line} for the currently selected frame."""
        records = self._write('-interpreter-exec console "cpptutor-decl"')
        deadline = time.monotonic() + self._timeout
        decls: dict[str, int] = {}
        while True:
            for rec in records:
                payload = rec.get("payload") or ""
                if rec["type"] == "console" and _DECL_MARKER in payload:
                    with contextlib.suppress(ValueError):
                        decls = json.loads(payload.split(_DECL_MARKER, 1)[1])
                if rec["type"] == "result":
                    return decls  # tolerate errors: no decls just means "show all"
            if time.monotonic() > deadline:
                return decls
            records = self._read_more()

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
        return_value=payload.get("return-value"),
    )
    if reason == "exited-signalled":
        # The inferior is already gone (e.g. SIGKILL from the OOM killer) —
        # report it as a crash, not a normal exit.
        info.reason = "signal"
        info.signal_name = payload.get("signal-name")
    elif reason.startswith("exited"):
        info.reason = "exited"
        # MI reports the inferior's exit code in octal.
        info.exit_code = int(payload.get("exit-code", "0"), 8)
    elif reason == "signal-received":
        info.reason = "signal"
        info.signal_name = payload.get("signal-name")
    return info
