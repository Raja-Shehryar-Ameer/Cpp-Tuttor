"""Content-addressed trace storage backing shareable permalinks."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

from app.models.trace import Trace

_ID = re.compile(r"^[0-9a-f]{16}$")


class TraceStore:
    def __init__(self, root: Path):
        self._root = root

    def save(self, code: str, stdin_text: str, trace: Trace) -> str:
        trace_id = hashlib.sha256(f"{code}\0{stdin_text}".encode()).hexdigest()[:16]
        self._root.mkdir(parents=True, exist_ok=True)
        (self._root / f"{trace_id}.json").write_text(trace.model_dump_json(), encoding="utf-8")
        return trace_id

    def load(self, trace_id: str) -> Trace | None:
        if not _ID.match(trace_id):
            return None
        path = self._root / f"{trace_id}.json"
        if not path.exists():
            return None
        return Trace.model_validate_json(path.read_text(encoding="utf-8"))
