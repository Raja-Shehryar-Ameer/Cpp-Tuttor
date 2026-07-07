from app.models.trace import Step, StepEvent, TraceStatus
from app.services.trace_service import TraceBuilder


def _step(line: int) -> Step:
    return Step(line=line, event=StepEvent.STEP, functionName="main", stdout="", stack=[], heap=[])


def test_builder_accumulates_and_finalizes_ok():
    builder = TraceBuilder("int main() {}", max_steps=10)
    assert builder.add(_step(1))
    assert builder.add(_step(2))
    trace = builder.build()
    assert trace.status == TraceStatus.OK
    assert trace.error is None
    assert [s.line for s in trace.steps] == [1, 2]
    assert trace.version == 1


def test_builder_enforces_step_limit():
    builder = TraceBuilder("", max_steps=2)
    assert builder.add(_step(1))
    assert builder.add(_step(2))
    assert not builder.add(_step(3))
    trace = builder.build()
    assert trace.status == TraceStatus.STEP_LIMIT
    assert len(trace.steps) == 2
    assert "limit" in (trace.error or "")


def test_builder_failure_status_wins():
    builder = TraceBuilder("", max_steps=10)
    builder.add(_step(1))
    builder.fail(TraceStatus.RUNTIME_ERROR, "Program crashed: segmentation fault.")
    trace = builder.build()
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert trace.steps  # steps up to the crash are preserved
