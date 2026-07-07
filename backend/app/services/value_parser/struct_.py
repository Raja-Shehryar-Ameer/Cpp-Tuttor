"""Fallback parser: any type nothing else claims is treated as a struct/class."""

from __future__ import annotations

from app.models.trace import ValueKind
from app.services.value_parser.base import (
    EvalContext,
    EvalError,
    ValueParser,
    parse_value,
    set_fallback,
)


class StructParser(ValueParser):
    kind = ValueKind.STRUCT

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        try:
            fields = ctx.children_of(expr)
        except EvalError:
            # Opaque type: at least show GDB's raw rendering.
            return {"value": ctx.evaluate(expr)}
        elements = [
            parse_value(name, ftype, f"({expr}).{name}", ctx, depth + 1)
            for name, ftype in fields
            if ftype  # skip artifacts like vtable pseudo-children
        ]
        return {"elements": elements}


set_fallback(StructParser())
