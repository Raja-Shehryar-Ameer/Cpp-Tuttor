"""Parser for raw pointers. `target` feeds the frontend's arrow layer."""

from __future__ import annotations

from app.models.trace import ValueKind
from app.services.value_parser.base import EvalContext, ValueParser, extract_address, register


@register(lambda t: t.endswith("*"))
class PointerParser(ValueParser):
    kind = ValueKind.POINTER

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        # GDB renders e.g. '0x7ffd12', '0x0', or '0x5591 "hi"' for char*.
        raw = ctx.evaluate(expr)
        return {"value": raw, "target": extract_address(raw)}
