"""C-language end-to-end: real gcc + GDB in the container. Marked integration."""

import pytest

from app.models.trace import StepEvent, TraceStatus, ValueKind
from tests.integration.test_samples import run_sample

pytestmark = pytest.mark.integration


def test_c_basics_traces_primitives():
    trace = run_sample("c/basics.c")
    assert trace.status == TraceStatus.OK
    assert trace.steps[-1].event == StepEvent.EXIT
    assert "sum = 10" in trace.steps[-1].stdout
    named = {v.name: v for s in trace.steps for f in s.stack for v in f.locals if v.name == "sum"}
    assert named["sum"].kind == ValueKind.PRIMITIVE


def test_c_pointers_swap():
    trace = run_sample("c/pointers.c")
    assert trace.status == TraceStatus.OK
    assert "x = 20, y = 15" in trace.steps[-1].stdout
    pointer_values = [
        v for s in trace.steps for f in s.stack for v in f.locals if v.kind == ValueKind.POINTER
    ]
    assert any(v.target for v in pointer_values)
    assert any(len(s.stack) >= 2 for s in trace.steps)


def test_c_malloc_list_builds_heap_objects():
    trace = run_sample("c/struct_list.c")
    assert trace.status == TraceStatus.OK
    assert "total = 6" in trace.steps[-1].stdout
    # malloc'd nodes must show up as live heap objects mid-run...
    assert any(len([h for h in s.heap if not h.freed]) >= 3 for s in trace.steps)
    # ...and every node is freed by exit.
    assert all(h.freed for h in trace.steps[-1].heap)


def test_c_use_after_free_flags_freed_object():
    trace = run_sample("c/heap_bug.c")
    assert trace.status == TraceStatus.OK
    assert any(any(h.freed for h in s.heap) for s in trace.steps)


def test_c_recursion_stacks_frames():
    trace = run_sample("c/recursion.c")
    assert trace.status == TraceStatus.OK
    assert "5! = 120" in trace.steps[-1].stdout
    # factorial(5): main + 5 nested calls on the deepest step.
    assert max(len(s.stack) for s in trace.steps) == 6


def test_c_compile_error_is_clean():
    from app.core.config import Settings
    from app.services.sandbox import SandboxRunner

    trace = SandboxRunner(Settings()).run("int main(void) { oops; }", "", "c")
    assert trace.status == TraceStatus.COMPILE_ERROR
    assert trace.error and "main.c" in trace.error
    assert "/work/" not in trace.error
