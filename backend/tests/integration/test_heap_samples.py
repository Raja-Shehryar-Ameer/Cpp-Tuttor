"""Phase 2 end-to-end: heap tracking, structs, STL rendering."""

import pytest

from app.models.trace import TraceStatus, ValueKind
from tests.integration.test_samples import run_sample

pytestmark = pytest.mark.integration


def test_struct_list_builds_and_frees_heap_nodes():
    trace = run_sample("struct_list.cpp")
    assert trace.status == TraceStatus.OK
    assert "total = 6" in trace.steps[-1].stdout
    # After the third push_front: three Nodes, chained via next-pointer targets.
    full = next(s for s in trace.steps if len(s.heap) == 3 and not any(h.freed for h in s.heap))
    assert all(h.label == "Node" for h in full.heap)
    addresses = {h.address for h in full.heap}
    targets = {
        f.target
        for h in full.heap
        for e in h.elements
        for f in (e.elements or [])
        if f.kind == ValueKind.POINTER and f.target
    }
    assert targets and targets <= addresses
    # Everything is freed by the end.
    assert all(h.freed for h in trace.steps[-1].heap)


def test_heap_bug_marks_use_after_free():
    trace = run_sample("heap_bug.cpp")
    assert trace.status == TraceStatus.OK
    freed_seen = [h for s in trace.steps for h in s.heap if h.freed]
    assert freed_seen, "delete must flip freed=True while the object stays visible"
    # A pointer keeps dangling at the freed node's address.
    freed_addrs = {h.address for h in freed_seen}
    dangling = [
        v
        for s in trace.steps
        for f in s.stack
        for v in f.locals
        if v.kind == ValueKind.POINTER and v.target in freed_addrs
    ]
    assert dangling


def test_vector_and_string_render():
    trace = run_sample("vector_string.cpp")
    assert trace.status == TraceStatus.OK
    values = [v for s in trace.steps for f in s.stack for v in f.locals]
    strings = [v for v in values if v.kind == ValueKind.STRING]
    assert any(v.value == '"hi there"' for v in strings)
    vectors = [v for v in values if v.kind == ValueKind.VECTOR and v.elements]
    assert any([e.value for e in v.elements] == ["4", "8", "15"] for v in vectors)
    assert "hi there: 27" in trace.steps[-1].stdout
