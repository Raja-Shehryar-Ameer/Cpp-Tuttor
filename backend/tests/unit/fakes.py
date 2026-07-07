"""Fake EvalContext backed by recorded GDB responses — no live GDB in unit tests."""

from __future__ import annotations

from app.services.value_parser.base import EvalError


class FakeEvalContext:
    def __init__(
        self,
        values: dict[str, str],
        addresses: dict[str, str] | None = None,
        children: dict[str, list[tuple[str, str]]] | None = None,
    ):
        self._values = values
        self._addresses = addresses or {}
        self._children = children or {}

    def evaluate(self, expr: str) -> str:
        if expr not in self._values:
            raise EvalError(f"no recorded value for {expr!r}")
        return self._values[expr]

    def address_of(self, expr: str) -> str | None:
        return self._addresses.get(expr)

    def children_of(self, expr: str) -> list[tuple[str, str]]:
        if expr not in self._children:
            raise EvalError(f"no recorded children for {expr!r}")
        return self._children[expr]
