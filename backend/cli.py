"""Phase 1 deliverable: `python cli.py ../samples/pointers.cpp > trace.json`."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from app.core.config import Settings
from app.models.trace import TraceStatus
from app.services.sandbox import SandboxRunner


def main() -> int:
    parser = argparse.ArgumentParser(description="Trace a C++ program into trace JSON.")
    parser.add_argument("source", type=Path, help="C++ source file")
    parser.add_argument("--stdin", type=Path, default=None, help="file piped to the program")
    parser.add_argument("--indent", type=int, default=2)
    args = parser.parse_args()

    stdin_text = args.stdin.read_text() if args.stdin else ""
    trace = SandboxRunner(Settings()).run(args.source.read_text(), stdin_text)

    print(trace.model_dump_json(indent=args.indent))
    if trace.status != TraceStatus.OK:
        print(f"[{trace.status.value}] {trace.error}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
