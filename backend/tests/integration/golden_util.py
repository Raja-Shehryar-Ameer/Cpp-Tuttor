"""Golden-trace normalization.

Raw traces are not byte-stable across runs (ASLR addresses, uninitialized
garbage values). Normalizing keeps what must not regress: step sequence,
stack/heap structure, kinds, pointer wiring, freed flags, stdout.
"""

from __future__ import annotations

import re
from typing import Any

from app.models.trace import Trace, Value

_HEX = re.compile(r"0x[0-9a-fA-F]+")


class _AddressMap:
    def __init__(self) -> None:
        self._ids: dict[str, str] = {}

    def resolve(self, address: str | None) -> str | None:
        if address is None:
            return None
        if address not in self._ids:
            self._ids[address] = f"A{len(self._ids)}"
        return self._ids[address]


def _normalize_value(value: Value, addresses: _AddressMap) -> dict[str, Any]:
    return {
        "name": value.name,
        "type": value.type,
        "kind": value.kind.value,
        "address": addresses.resolve(value.address),
        "target": addresses.resolve(value.target),
        "elements": (
            None
            if value.elements is None
            else [_normalize_value(e, addresses) for e in value.elements]
        ),
    }


def normalize(trace: Trace) -> dict[str, Any]:
    addresses = _AddressMap()
    steps = []
    for step in trace.steps:
        steps.append(
            {
                "line": step.line,
                "event": step.event.value,
                "functionName": step.functionName,
                "stdout": _HEX.sub("0xADDR", step.stdout),
                "stack": [
                    {
                        "frameId": frame.frameId,
                        "functionName": frame.functionName,
                        "locals": [_normalize_value(v, addresses) for v in frame.locals],
                    }
                    for frame in step.stack
                ],
                "heap": [
                    {
                        "address": addresses.resolve(obj.address),
                        "label": obj.label,
                        "kind": obj.kind.value,
                        "freed": obj.freed,
                        # Freed memory holds allocator garbage — never compare it.
                        "elements": (
                            "<freed>"
                            if obj.freed
                            else [_normalize_value(v, addresses) for v in obj.elements]
                        ),
                    }
                    for obj in step.heap
                ],
            }
        )
    return {"status": trace.status.value, "steps": steps}
