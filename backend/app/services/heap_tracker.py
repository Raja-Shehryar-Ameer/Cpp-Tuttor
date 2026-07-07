"""Heap tracking via breakpoints on allocator symbols.

Allocations are recorded only when the nearest non-allocator caller is user
code, so internal libstdc++ allocations (cout buffers, vector growth) stay
invisible. Objects are typed lazily, from the pointers that reference them.
"""

from __future__ import annotations

import contextlib
from dataclasses import dataclass
from pathlib import Path

from app.models.trace import Frame, HeapObject, Value, ValueKind
from app.services.gdb_driver import GdbSession, GdbSessionError, GdbTimeout, StopInfo
from app.services.value_parser import parse_value
from app.services.value_parser.base import EvalError, extract_address

_ALLOC_FUNCS = ("operator new", "malloc", "__libc_malloc", "__GI___libc_malloc")
_FREE_FUNCS = ("operator delete", "free", "__libc_free", "__GI___libc_free")
_BREAKPOINTS = (
    "operator new",
    "operator new[]",
    "operator delete",
    "operator delete[]",
    "malloc",
    "free",
)
_MAX_ALLOC_STOPS = 500
# Allocators lack debug info, so a completed finish carries no MI reason.
_FINISH_DONE = ("function-finished", "unknown")


@dataclass
class _HeapEntry:
    address: str
    size: int | None
    freed: bool = False
    pointee_type: str | None = None


def _is_allocator(func: str | None) -> bool:
    return func is not None and func.startswith((*_ALLOC_FUNCS, *_FREE_FUNCS))


class HeapTracker:
    def __init__(self, source_path: Path):
        self._source = str(source_path)
        self._entries: dict[str, _HeapEntry] = {}

    def install(self, session: GdbSession) -> None:
        for location in _BREAKPOINTS:
            with contextlib.suppress(GdbSessionError):
                session.set_breakpoint(location)

    # ---- intercepting allocator stops -------------------------------------

    def resolve(self, session: GdbSession, stop: StopInfo) -> StopInfo:
        """Consume allocator breakpoint stops until execution rests elsewhere."""
        for _ in range(_MAX_ALLOC_STOPS):
            if stop.reason != "breakpoint-hit" or not _is_allocator(stop.function):
                return stop
            stop = self._handle_one(session, stop)
        raise GdbSessionError("allocator breakpoints kept firing")

    def _handle_one(self, session: GdbSession, stop: StopInfo) -> StopInfo:
        freeing = stop.function is not None and stop.function.startswith(_FREE_FUNCS)
        arg = self._first_arg(session)
        user_caller = self._nearest_real_caller_is_user(session)
        if freeing:
            self._mark_freed(arg)
            return self._leave(session)

        size = None
        if arg is not None:
            with contextlib.suppress(ValueError):
                size = int(arg, 0)
        finished = self._leave(session)
        if not user_caller or finished.reason not in _FINISH_DONE:
            return finished
        address = extract_address(finished.return_value or "") or self._return_register(session)
        # Nested malloc-under-new reports the same address; the dict dedupes it.
        if address is not None and address not in self._entries:
            self._entries[address] = _HeapEntry(address=address, size=size)
        return finished

    def _leave(self, session: GdbSession) -> StopInfo:
        try:
            return session.finish()
        except GdbTimeout:
            raise
        except GdbSessionError:
            return session.next()

    def _first_arg(self, session: GdbSession) -> str | None:
        # Allocators have no debug info; read the SysV/AAPCS first-arg register.
        for reg in ("$rdi", "$x0"):
            try:
                return session.evaluate(f"(unsigned long long){reg}")
            except EvalError:
                continue
        return None

    def _return_register(self, session: GdbSession) -> str | None:
        for reg in ("$rax", "$x0"):
            try:
                return extract_address(session.evaluate(f"(void *){reg}"))
            except EvalError:
                continue
        return None

    def _nearest_real_caller_is_user(self, session: GdbSession) -> bool:
        try:
            frames = session.get_stack()
        except GdbSessionError:
            return False
        for frame in frames[1:]:
            if _is_allocator(frame.get("func")):
                continue
            return frame.get("fullname") == self._source
        return False

    def _mark_freed(self, arg: str | None) -> None:
        if arg is None:
            return
        with contextlib.suppress(ValueError):
            address = hex(int(arg, 0))
            if address in self._entries:
                self._entries[address].freed = True

    # ---- snapshotting -------------------------------------------------------

    def snapshot(self, session: GdbSession, stack: list[Frame]) -> list[HeapObject]:
        self._infer_types(self._pointers_in(v for f in stack for v in f.locals))
        objects = [self._render(session, e) for e in self._entries.values()]
        # Heap objects may point at each other (linked lists): infer, then re-render.
        self._infer_types(self._pointers_in(v for o in objects for v in o.elements))
        return [self._render(session, e) for e in self._entries.values()]

    def _pointers_in(self, values) -> list[Value]:
        found: list[Value] = []
        queue = list(values)
        while queue:
            value = queue.pop()
            if value.kind == ValueKind.POINTER and value.target:
                found.append(value)
            if value.elements:
                queue.extend(value.elements)
        return found

    def _infer_types(self, pointers: list[Value]) -> None:
        for pointer in pointers:
            entry = self._entries.get(pointer.target or "")
            if entry is not None and entry.pointee_type is None:
                entry.pointee_type = pointer.type.rstrip("* ").strip()

    def _render(self, session: GdbSession, entry: _HeapEntry) -> HeapObject:
        if entry.pointee_type is None:
            label = f"{entry.size} bytes" if entry.size else "allocation"
            return HeapObject(
                address=entry.address, label=label, kind=ValueKind.PRIMITIVE, elements=[]
            )
        count = self._element_count(session, entry)
        try:
            if count > 1:
                elements = [
                    parse_value(
                        f"[{i}]",
                        entry.pointee_type,
                        f"*(({entry.pointee_type} *){entry.address} + {i})",
                        session,
                        depth=1,
                    )
                    for i in range(min(count, 64))
                ]
                label, kind = f"{entry.pointee_type}[{count}]", ValueKind.ARRAY
            else:
                inner = parse_value(
                    "*", entry.pointee_type, f"*(({entry.pointee_type} *){entry.address})", session
                )
                elements, label, kind = [inner], entry.pointee_type, inner.kind
        except EvalError:
            elements, label, kind = [], entry.pointee_type, ValueKind.PRIMITIVE
        return HeapObject(
            address=entry.address, label=label, kind=kind, elements=elements, freed=entry.freed
        )

    def _element_count(self, session: GdbSession, entry: _HeapEntry) -> int:
        if entry.size is None or entry.pointee_type is None:
            return 1
        try:
            unit = int(session.evaluate(f"sizeof({entry.pointee_type})"))
        except (EvalError, ValueError):
            return 1
        return max(1, entry.size // unit) if unit else 1
