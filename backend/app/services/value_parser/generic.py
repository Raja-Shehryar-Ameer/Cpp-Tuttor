"""Fallback for types no strategy matches yet: show GDB's raw rendering."""

from __future__ import annotations

from app.models.trace import ValueKind
from app.services.value_parser.base import EvalContext, ValueParser, set_fallback


class GenericParser(ValueParser):
    kind = ValueKind.STRUCT

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        return {"value": ctx.evaluate(expr)}


set_fallback(GenericParser())
