"""In-container entrypoint: {"code", "stdin"} JSON on stdin -> trace JSON on stdout.

Runs only inside the cpptutor-tracer image; the host never executes user code.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

from app.core.config import Settings
from app.models.trace import Trace, TraceStatus
from app.services.compile_service import CompileService
from app.services.gdb_driver import GdbSession
from app.services.trace_service import TraceService


def main() -> int:
    payload = json.load(sys.stdin)
    code: str = payload["code"]
    stdin_text: str = payload.get("stdin", "")
    language: str = payload.get("language", "cpp")

    # Program input arrives from browsers and pasted text with any line-ending
    # convention; a stray '\r' silently breaks string comparisons and parsing
    # in every language, so normalize once at the boundary.
    stdin_text = stdin_text.replace("\r\n", "\n").replace("\r", "\n")

    settings = Settings()
    try:
        if language == "python":
            # No compiler, no GDB — sys.settrace in this same process; the
            # container provides exactly the isolation it gives C programs.
            from app.services.py_tracer import trace_python

            trace = trace_python(code, stdin_text, settings)
        else:
            # The extension drives both the gcc frontend and GDB's DWARF language.
            source_name = "main.c" if language == "c" else "main.cpp"
            work_dir = Path(os.environ.get("CPPTUTOR_WORK_DIR", "/work"))
            (work_dir / source_name).write_text(code)
            (work_dir / "stdin.txt").write_text(stdin_text)
            service = TraceService(CompileService(), GdbSession, settings)
            trace = service.trace(work_dir, source_name)
    except Exception:
        # Never leak a stack trace to the student.
        lang_label = "Python" if language == "python" else "C/C++"
        trace = Trace(
            status=TraceStatus.RUNTIME_ERROR,
            error="The tracer could not handle this program. "
            f"It may use a {lang_label} feature that is not supported yet.",
            sourceCode=code,
        )
    print(trace.model_dump_json())
    return 0


if __name__ == "__main__":
    sys.exit(main())
