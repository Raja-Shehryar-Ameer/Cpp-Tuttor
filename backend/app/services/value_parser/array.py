"""Parser for fixed-size C arrays, including nested dimensions."""

from __future__ import annotations

import re

from app.models.trace import ValueKind
from app.services.value_parser.base import (
    MAX_ELEMENTS,
    EvalContext,
    ValueParser,
    parse_value,
    register,
)

_DIM = re.compile(r"\[(\d+)\]")


@register(lambda t: bool(re.search(r"\[\d+\]$", t)))
class ArrayParser(ValueParser):
    kind = ValueKind.ARRAY

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        match = _DIM.search(type_str)
        assert match is not None  # guaranteed by the registry matcher
        count = int(match.group(1))
        # 'int [2][3]' minus its first dimension is the element type 'int [3]'.
        element_type = _DIM.sub("", type_str, count=1).strip()
        elements = [
            parse_value(f"[{i}]", element_type, f"({expr})[{i}]", ctx, depth + 1)
            for i in range(min(count, MAX_ELEMENTS))
        ]
        return {"elements": elements}
