"""Structural invariants every trace must satisfy, whatever the program.

Shared by the unit suite (in-process Python tracer) and the integration
suite (real Docker traces of every shipped sample). Asserting shape instead
of content catches whole classes of tracer bugs without golden churn.
"""

from __future__ import annotations

from app.models.trace import Trace, TraceStatus, Value, ValueKind


def _walk(values: list[Value]):
    for value in values:
        yield value
        if value.elements:
            yield from _walk(value.elements)


def assert_trace_invariants(trace: Trace, python: bool = False) -> None:
    assert trace.version == 1
    if trace.status != TraceStatus.OK:
        assert trace.error, f"status {trace.status} must carry an error message"
    if trace.status == TraceStatus.COMPILE_ERROR:
        assert trace.steps == [], "compile errors produce no steps"

    previous_stdout = ""
    for i, step in enumerate(trace.steps):
        where = f"step {i} ({step.event}@{step.functionName}:{step.line})"

        # stdout is cumulative: each step extends (or repeats) the previous one.
        assert step.stdout.startswith(previous_stdout), f"{where}: stdout not prefix-monotone"
        previous_stdout = step.stdout

        # stack[0] is the innermost frame and names the step; main/<module> is f0.
        frame_ids = [f.frameId for f in step.stack]
        assert len(frame_ids) == len(set(frame_ids)), f"{where}: duplicate frameIds"
        if step.stack:
            assert step.stack[0].functionName == step.functionName, (
                f"{where}: functionName != innermost frame"
            )
            assert step.stack[-1].frameId == "f0", f"{where}: outermost frame is not f0"

        addresses = [h.address for h in step.heap]
        assert len(addresses) == len(set(addresses)), f"{where}: duplicate heap addresses"
        heap_addresses = set(addresses)

        all_values = [v for f in step.stack for v in _walk(f.locals)] + [
            v for h in step.heap for v in _walk(h.elements)
        ]
        for value in all_values:
            if value.kind == ValueKind.POINTER:
                assert value.elements is None, f"{where}: pointer {value.name} has elements"
            else:
                assert value.target is None, f"{where}: non-pointer {value.name} has a target"

        if python:
            assert not any(h.freed for h in step.heap), (
                f"{where}: Python never frees — freed flag is a C/C++ concept"
            )
            for value in all_values:
                assert value.address is None, (
                    f"{where}: Python value {value.name} carries an address"
                )
                if value.kind == ValueKind.POINTER and value.target and value.isInitialized:
                    assert value.target in heap_addresses, (
                        f"{where}: reference {value.name} → {value.target} has no object"
                    )
