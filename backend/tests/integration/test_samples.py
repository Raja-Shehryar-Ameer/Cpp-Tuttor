"""End-to-end: real Docker container, real g++, real GDB. Marked integration."""

from pathlib import Path

import pytest

from app.core.config import Settings
from app.models.trace import StepEvent, TraceStatus, ValueKind
from app.services.sandbox import SandboxRunner

SAMPLES = Path(__file__).resolve().parents[3] / "samples"

pytestmark = pytest.mark.integration


def run_sample(name: str, stdin: str = ""):
    code = (SAMPLES / name).read_text()
    language = "c" if name.endswith(".c") else "cpp"
    return SandboxRunner(Settings()).run(code, stdin, language)


def test_basics_traces_primitives():
    trace = run_sample("basics.cpp")
    assert trace.status == TraceStatus.OK
    assert trace.steps
    assert trace.steps[-1].event == StepEvent.EXIT
    assert "sum = 7" in trace.steps[-1].stdout
    # A mid-execution step must expose main's locals with real values.
    named = {v.name: v for s in trace.steps for f in s.stack for v in f.locals if v.name == "sum"}
    assert named["sum"].kind == ValueKind.PRIMITIVE


def test_pointers_have_targets_and_swap_works():
    trace = run_sample("pointers.cpp")
    assert trace.status == TraceStatus.OK
    assert "x = 20, y = 15" in trace.steps[-1].stdout
    pointer_values = [
        v for s in trace.steps for f in s.stack for v in f.locals if v.kind == ValueKind.POINTER
    ]
    assert any(v.target for v in pointer_values)
    # swap() must appear as a called frame.
    assert any(len(s.stack) >= 2 for s in trace.steps)


def test_arrays_render_elements():
    trace = run_sample("arrays.cpp")
    assert trace.status == TraceStatus.OK
    arrays = [
        v for s in trace.steps for f in s.stack for v in f.locals if v.kind == ValueKind.ARRAY
    ]
    assert arrays
    nums = next(v for v in arrays if v.name == "nums")
    assert nums.elements is not None and len(nums.elements) == 4
    assert "total = 47" in trace.steps[-1].stdout


def test_recursion_stacks_frames():
    trace = run_sample("recursion.cpp")
    assert trace.status == TraceStatus.OK
    assert "4! = 24" in trace.steps[-1].stdout
    # factorial(4) → at some point 5 user frames: main + 4 nested calls.
    assert max(len(s.stack) for s in trace.steps) == 5
    assert any(s.event == StepEvent.RETURN for s in trace.steps)


def test_compile_error_is_clean():
    trace = SandboxRunner(Settings()).run("int main() { oops; }", "")
    assert trace.status == TraceStatus.COMPILE_ERROR
    assert trace.error and "oops" in trace.error
    assert "/work/" not in trace.error
    assert trace.steps == []
