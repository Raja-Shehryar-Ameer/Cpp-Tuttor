"""The sys.settrace tracer, exercised fully in-process — no Docker, no GDB."""

from __future__ import annotations

from textwrap import dedent

from app.core.config import Settings
from app.models.trace import StepEvent, TraceStatus, ValueKind
from app.services.py_tracer import trace_python


def run(code: str, stdin: str = "", **overrides):
    return trace_python(dedent(code), stdin, Settings(**overrides))


def locals_of(step, frame_idx=0):
    return {v.name: v for v in step.stack[frame_idx].locals}


# ---- happy path -------------------------------------------------------------


def test_basics_step_sequence_and_values():
    trace = run(
        """
        x = 3
        y = 4
        total = x + y
        print("total =", total)
        """
    )
    assert trace.status == TraceStatus.OK
    assert trace.steps[0].event == StepEvent.CALL  # entering <module>
    assert trace.steps[-1].event == StepEvent.EXIT
    assert "total = 7" in trace.steps[-1].stdout
    last_named = locals_of(trace.steps[-2])
    assert last_named["total"].kind == ValueKind.PRIMITIVE
    assert last_named["total"].value == "7"
    # stdout is cumulative: present before the exit step too
    assert "total = 7" in trace.steps[-2].stdout


def test_function_call_return_events_and_frames():
    trace = run(
        """
        def double(n):
            return n * 2

        result = double(21)
        """
    )
    assert trace.status == TraceStatus.OK
    calls = [s for s in trace.steps if s.event == StepEvent.CALL and s.functionName == "double"]
    assert calls, "entering double() must emit a call step"
    deepest = max(trace.steps, key=lambda s: len(s.stack))
    assert [f.functionName for f in deepest.stack] == ["double", "<module>"]
    # frame ids number from the bottom: module frame is f0
    assert [f.frameId for f in deepest.stack] == ["f1", "f0"]
    assert any(s.event == StepEvent.RETURN for s in trace.steps)


def test_string_locals_render_as_string_kind():
    trace = run("name = 'ada'\n")
    named = locals_of(trace.steps[-2])
    assert named["name"].kind == ValueKind.STRING
    assert named["name"].value == "'ada'"


# ---- heap mapping -----------------------------------------------------------


def test_list_goes_to_heap_and_aliases_share_the_object():
    trace = run(
        """
        a = [1, 2, 3]
        b = a
        c = [1, 2, 3]
        """
    )
    step = trace.steps[-2]
    named = locals_of(step)
    assert named["a"].kind == ValueKind.POINTER
    assert named["a"].target == named["b"].target, "aliases must point at one object"
    assert named["c"].target != named["a"].target, "equal values are still distinct objects"
    heap = {h.address: h for h in step.heap}
    obj = heap[named["a"].target]
    assert obj.kind == ValueKind.ARRAY
    assert obj.label == "list[3]"
    assert [e.value for e in obj.elements] == ["1", "2", "3"]


def test_dict_maps_to_struct_with_repr_keys():
    trace = run("ages = {'ada': 36, 'alan': 41}\n")
    step = trace.steps[-2]
    obj = step.heap[0]
    assert obj.kind == ValueKind.STRUCT
    assert obj.label == "dict[2]"
    assert [e.name for e in obj.elements] == ["'ada'", "'alan'"]


def test_set_elements_are_sorted_for_determinism():
    trace = run("s = {'pear', 'apple', 'plum'}\n")
    obj = trace.steps[-2].heap[0]
    assert obj.label == "set[3]"
    assert [e.value for e in obj.elements] == ["'apple'", "'pear'", "'plum'"]


def test_user_object_becomes_labelled_struct():
    trace = run(
        """
        class Point:
            def __init__(self, x, y):
                self.x = x
                self.y = y

        p = Point(3, 4)
        """
    )
    step = trace.steps[-2]
    named = locals_of(step)
    assert named["p"].kind == ValueKind.POINTER
    heap = {h.address: h for h in step.heap}
    obj = heap[named["p"].target]
    assert obj.label == "Point"
    assert {e.name: e.value for e in obj.elements} == {"x": "3", "y": "4"}


def test_nested_containers_wire_pointer_to_pointer():
    trace = run("matrix = [[1], [2]]\n")
    step = trace.steps[-2]
    heap = {h.address: h for h in step.heap}
    outer = heap[locals_of(step)["matrix"].target]
    assert all(e.kind == ValueKind.POINTER for e in outer.elements)
    assert all(e.target in heap for e in outer.elements)


def test_self_referencing_list_does_not_recurse_forever():
    trace = run("a = [1]\na.append(a)\n")
    assert trace.status == TraceStatus.OK
    step = trace.steps[-2]
    obj = step.heap[0]
    assert obj.elements[1].target == obj.address


# ---- failure classes ----------------------------------------------------------


def test_syntax_error_is_a_compile_error_citing_the_line():
    trace = run("def broken(:\n    pass\n")
    assert trace.status == TraceStatus.COMPILE_ERROR
    assert trace.error.startswith("main.py:1:")
    assert trace.steps == []


def test_uncaught_exception_ends_with_exception_step():
    trace = run(
        """
        def explode():
            raise ValueError("boom")

        explode()
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "ValueError: boom" in trace.error
    last = trace.steps[-1]
    assert last.event == StepEvent.EXCEPTION
    assert last.line == 3
    assert last.stack[0].functionName == "explode"


def test_handled_exception_is_not_a_crash():
    trace = run(
        """
        try:
            1 / 0
        except ZeroDivisionError:
            ok = True
        """
    )
    assert trace.status == TraceStatus.OK


def test_runaway_recursion_raises_a_teachable_error():
    trace = run(
        """
        def down(n):
            return down(n + 1)

        down(0)
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "RecursionError" in trace.error


def test_step_limit_stops_exactly_at_max_steps():
    trace = run(
        """
        total = 0
        for i in range(100000):
            total += i
        """,
        max_steps=50,
    )
    assert trace.status == TraceStatus.STEP_LIMIT
    assert len(trace.steps) == 50


def test_wall_clock_timeout_reports_looping_forever():
    trace = run("while True:\n    pass\n", wall_timeout_s=0)
    assert trace.status == TraceStatus.TIMEOUT
    assert "looping forever" in trace.error


# ---- stdin / stdout -------------------------------------------------------------


def test_input_reads_from_the_provided_stdin():
    trace = run(
        """
        name = input()
        print("hi", name)
        """,
        stdin="ada\n",
    )
    assert trace.status == TraceStatus.OK
    assert "hi ada" in trace.steps[-1].stdout


def test_input_past_eof_names_the_stdin_box():
    trace = run("first = input()\nsecond = input()\n", stdin="only-one\n")
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "EOFError" in trace.error
    assert "stdin box" in trace.error


def test_stdin_buffer_reads_real_bytes():
    trace = run(
        """
        import sys
        raw = sys.stdin.buffer.read()
        print(len(raw), type(raw).__name__)
        """,
        stdin="abcd\n",
    )
    assert trace.status == TraceStatus.OK
    assert "5 bytes" in trace.steps[-1].stdout


def test_crlf_stdin_reads_clean_lines():
    trace = run(
        'name = input()\nprint("match" if name == "ada" else repr(name))\n',
        stdin="ada\r\n",
    )
    assert trace.status == TraceStatus.OK
    assert "match" in trace.steps[-1].stdout


def test_input_prompt_lands_in_stdout():
    trace = run('name = input("name? ")\nprint("hi", name)\n', stdin="ada\n")
    assert trace.status == TraceStatus.OK
    assert "name? hi ada" in trace.steps[-1].stdout


def test_unicode_stdin_round_trips():
    trace = run('w = input()\nprint("word:", w, len(w))\n', stdin="héllo\n")
    assert trace.status == TraceStatus.OK
    assert "word: héllo 5" in trace.steps[-1].stdout


def test_output_flood_is_truncated():
    trace = run(
        """
        for i in range(40):
            print("x" * 4096)
        """,
        output_limit_bytes=8192,
    )
    assert "[output truncated]" in trace.steps[-1].stdout
    assert len(trace.steps[-1].stdout) < 10000


def test_exit_call_is_a_normal_exit():
    trace = run("import sys\nprint('bye')\nsys.exit(0)\n")
    assert trace.status == TraceStatus.OK
    assert trace.steps[-1].event == StepEvent.EXIT
    assert "bye" in trace.steps[-1].stdout
