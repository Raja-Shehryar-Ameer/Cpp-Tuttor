"""Parser for primitive scalar types."""

from __future__ import annotations

from app.models.trace import ValueKind
from app.services.value_parser.base import EvalContext, ValueParser, register

PRIMITIVE_TYPES = {
    "int",
    "long",
    "long long",
    "short",
    "unsigned int",
    "unsigned long",
    "unsigned long long",
    "unsigned short",
    "unsigned char",
    "signed char",
    "char",
    "bool",
    "float",
    "double",
    "long double",
    "size_t",
    "unsigned",
}


@register(lambda t: t in PRIMITIVE_TYPES)
class PrimitiveParser(ValueParser):
    kind = ValueKind.PRIMITIVE

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        return {"value": ctx.evaluate(expr)}
