"""Compiles user source with debug info; raises CompileError with a clean message."""

from __future__ import annotations

import subprocess
from pathlib import Path

GXX_FLAGS = ["-g", "-O0", "-fno-omit-frame-pointer", "-std=c++17"]


class CompileError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class CompileService:
    def compile(self, source: Path, out_dir: Path) -> Path:
        binary = out_dir / "prog"
        result = subprocess.run(
            ["g++", *GXX_FLAGS, "-o", str(binary), str(source)],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if result.returncode != 0:
            # Strip temp-dir paths so students see 'main.cpp:3' not '/work/main.cpp:3'.
            raise CompileError(result.stderr.replace(str(source), source.name).strip())
        return binary
