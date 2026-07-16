"""Python tracing through the real container. Marked integration.

The heavy behavioral coverage lives in unit/test_py_tracer.py (in-process);
these prove the Docker plumbing: language dispatch, schema fidelity, aliasing
addresses surviving the JSON round trip.
"""

import pytest

from app.models.trace import StepEvent, TraceStatus, ValueKind
from tests.integration.test_samples import run_sample

pytestmark = pytest.mark.integration


def test_aliasing_sample_shares_one_heap_object():
    trace = run_sample("py/aliasing.py")
    assert trace.status == TraceStatus.OK
    assert "a = [1, 2, 3, 4]" in trace.steps[-1].stdout
    step = next(s for s in reversed(trace.steps) if s.stack)
    named = {v.name: v for v in step.stack[-1].locals}
    assert named["a"].kind == ValueKind.POINTER
    assert named["a"].target == named["b"].target
    assert named["c"].target != named["a"].target
    addresses = {h.address for h in step.heap}
    assert named["a"].target in addresses and named["c"].target in addresses


def test_objects_sample_wires_nodes_like_a_linked_list():
    trace = run_sample("py/objects.py")
    assert trace.status == TraceStatus.OK
    assert "nodes: 3" in trace.steps[-1].stdout
    step = next(s for s in reversed(trace.steps) if s.heap)
    nodes = [h for h in step.heap if h.label == "Node"]
    assert len(nodes) == 3
    # each node's `next` field is a pointer to another node (or None primitive)
    nexts = [e for h in nodes for e in h.elements if e.name == "next"]
    assert sum(1 for e in nexts if e.kind == ValueKind.POINTER) == 2


def test_exception_sample_crashes_with_the_python_message():
    trace = run_sample("py/exception.py")
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "ZeroDivisionError" in trace.error
    assert trace.steps[-1].event == StepEvent.EXCEPTION
    # the successful first call's output survives the crash
    assert "6.0" in trace.steps[-1].stdout


def test_python_reads_stdin_via_input():
    trace = run_sample("py/basics.py")  # no stdin needed, sanity
    assert trace.status == TraceStatus.OK
    from app.core.config import Settings
    from app.services.sandbox import SandboxRunner

    echo = SandboxRunner(Settings()).run("name = input()\nprint('hi', name)\n", "ada\n", "python")
    assert echo.status == TraceStatus.OK
    assert "hi ada" in echo.steps[-1].stdout
