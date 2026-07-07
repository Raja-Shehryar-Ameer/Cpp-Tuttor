"""Parsers for std::string and std::vector (libstdc++ layout, pinned by the image)."""

from __future__ import annotations

import re

from app.models.trace import ValueKind
from app.services.value_parser.base import (
    MAX_ELEMENTS,
    EvalContext,
    EvalError,
    ValueParser,
    parse_value,
    register,
)

_QUOTED = re.compile(r'"(?:[^"\\]|\\.)*"')


def _is_string(t: str) -> bool:
    return t in ("std::string", "string") or "basic_string<char" in t


def _is_vector(t: str) -> bool:
    return t.startswith("std::vector<")


def _vector_element_type(type_str: str) -> str:
    """First template argument of 'std::vector<T, std::allocator<T> >'."""
    inner = type_str[len("std::vector<") :]
    depth = 0
    for i, ch in enumerate(inner):
        if ch == "<":
            depth += 1
        elif ch == ">":
            if depth == 0:
                return inner[:i].strip()
            depth -= 1
        elif ch == "," and depth == 0:
            return inner[:i].strip()
    return inner.strip()


@register(_is_string)
class StringParser(ValueParser):
    kind = ValueKind.STRING

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        # With libstdc++ pretty-printers loaded this is already '"text"'.
        raw = ctx.evaluate(expr)
        match = _QUOTED.search(raw)
        if match is None:
            # Printers unavailable: read the character buffer directly.
            raw = ctx.evaluate(f"({expr})._M_dataplus._M_p")
            match = _QUOTED.search(raw)
        return {"value": match.group(0) if match else raw}


@register(_is_vector)
class VectorParser(ValueParser):
    kind = ValueKind.VECTOR

    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict:
        start = f"({expr})._M_impl._M_start"
        try:
            length = int(ctx.evaluate(f"(int)(({expr})._M_impl._M_finish - {start})"))
        except (EvalError, ValueError):
            # Unexpected layout: fall back to GDB's own rendering.
            return {"value": ctx.evaluate(expr)}
        element_type = _vector_element_type(type_str)
        elements = [
            parse_value(f"[{i}]", element_type, f"*({start} + {i})", ctx, depth + 1)
            for i in range(min(length, MAX_ELEMENTS))
        ]
        return {"elements": elements}
