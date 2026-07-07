"""Strategy + Registry: one parser per Value kind, selected by GDB type signature.

Adding support for a new type = one new module that calls @register. Zero edits here.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from collections.abc import Callable
from typing import Protocol

from app.models.trace import Value, ValueKind

MAX_DEPTH = 6
MAX_ELEMENTS = 64

_HEX = re.compile(r"0x[0-9a-fA-F]+")


class EvalError(Exception):
    """A GDB evaluation failed (optimized out, invalid expression, ...)."""


class EvalContext(Protocol):
    """What parsers need from GDB. GdbSession implements this; tests use fakes."""

    def evaluate(self, expr: str) -> str: ...

    def address_of(self, expr: str) -> str | None: ...

    def children_of(self, expr: str) -> list[tuple[str, str]]: ...


def extract_address(text: str) -> str | None:
    """Pull the first hex address out of a GDB value string like '(int *) 0x7ffd...'."""
    match = _HEX.search(text)
    if match is None or int(match.group(0), 16) == 0:
        return None
    return match.group(0)


class ValueParser(ABC):
    """Template Method: parse() handles the shared envelope, parse_payload() the kind."""

    kind: ValueKind

    def parse(self, name: str, type_str: str, expr: str, ctx: EvalContext, depth: int = 0) -> Value:
        try:
            address = ctx.address_of(expr)
        except EvalError:
            address = None
        if depth >= MAX_DEPTH:
            return Value(name=name, type=type_str, kind=self.kind, value="…", address=address)
        try:
            payload = self.parse_payload(type_str, expr, ctx, depth)
        except EvalError:
            payload = {"value": "<unavailable>"}
        return Value(name=name, type=type_str, kind=self.kind, address=address, **payload)

    @abstractmethod
    def parse_payload(self, type_str: str, expr: str, ctx: EvalContext, depth: int) -> dict: ...


Matcher = Callable[[str], bool]
_registry: list[tuple[Matcher, ValueParser]] = []


def register(matcher: Matcher) -> Callable[[type[ValueParser]], type[ValueParser]]:
    def decorator(cls: type[ValueParser]) -> type[ValueParser]:
        _registry.append((matcher, cls()))
        return cls

    return decorator


def set_fallback(parser: ValueParser) -> None:
    global _fallback
    _fallback = parser


_fallback: ValueParser | None = None


def parser_for(type_str: str) -> ValueParser:
    for matcher, parser in _registry:
        if matcher(type_str):
            return parser
    if _fallback is None:
        raise LookupError(f"no parser registered for type: {type_str}")
    return _fallback


def parse_value(name: str, type_str: str, expr: str, ctx: EvalContext, depth: int = 0) -> Value:
    """Single entry point: classify the type, dispatch to its Strategy."""
    # References render as their referent; GDB auto-dereferences the expression.
    clean = type_str.strip()
    if clean.endswith("&"):
        clean = clean.rstrip(" &")
    return parser_for(clean).parse(name, clean, expr, ctx, depth)
