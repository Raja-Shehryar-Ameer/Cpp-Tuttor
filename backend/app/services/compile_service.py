"""Compiles user source with debug info; raises CompileError with a clean message."""

from __future__ import annotations

import subprocess
from pathlib import Path

# zero-init makes not-yet-assigned locals render as 0 instead of random garbage,
# which also keeps traces deterministic for golden tests.
_COMMON_FLAGS = ["-g", "-O0", "-fno-omit-frame-pointer", "-ftrivial-auto-var-init=zero"]
# Keyed by source suffix so compile() needs no extra language parameter.
_TOOLCHAIN = {
    ".c": ["gcc", "-std=c17", *_COMMON_FLAGS],
    ".cpp": ["g++", "-std=c++17", *_COMMON_FLAGS],
}


class CompileError(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class CompileService:
    def compile(self, source: Path, out_dir: Path) -> Path:
        binary = out_dir / "prog"
        toolchain = _TOOLCHAIN.get(source.suffix, _TOOLCHAIN[".cpp"])
        try:
            result = subprocess.run(
                [*toolchain, "-o", str(binary), str(source)],
                capture_output=True,
                text=True,
                timeout=30,
            )
        except subprocess.TimeoutExpired:
            raise CompileError("compilation took longer than 30 s — simplify the program") from None
        if result.returncode != 0:
            # Strip temp-dir paths so students see 'main.cpp:3' not '/work/main.cpp:3'.
            raise CompileError(result.stderr.replace(str(source), source.name).strip())
        return binary
