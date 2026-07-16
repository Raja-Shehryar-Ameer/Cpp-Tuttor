"""Hostile programs get clear student-facing errors. Real Docker; marked integration.

Each case provokes one failure class; asserts target the message a student
sees, not internals. The two timeout cases take ~25 s each by design.
"""

from app.core.config import Settings
from app.models.trace import StepEvent, TraceStatus
from app.services.sandbox import SandboxRunner

import pytest

pytestmark = pytest.mark.integration


def run(code: str, stdin: str = "", language: str = "cpp"):
    return SandboxRunner(Settings()).run(code, stdin, language)


# ---- loops that never end -------------------------------------------------


def test_infinite_loop_hits_the_step_limit_with_playable_steps():
    # A fast infinite loop burns through the 1000-step budget long before the
    # 25 s wall clock — step_limit (with its shrink-the-loop hint) is the
    # correct student outcome, and every captured step stays playable.
    trace = run(
        """
        int main() {
            long x = 0;
            while (true) {
                x += 1;
                x -= 1;
            }
        }
        """
    )
    assert trace.status == TraceStatus.STEP_LIMIT
    assert len(trace.steps) == Settings().max_steps


def test_one_line_spin_still_times_out():
    # `for(;;);` never reaches a new source line, so the wall clock never gets
    # polled — this exercises the stuck-MI-operation branch instead.
    trace = run("int main() { for (;;); }")
    assert trace.status == TraceStatus.TIMEOUT
    assert trace.error


# ---- stack overflows vs plain segfaults ------------------------------------


def test_runaway_recursion_reports_stack_overflow():
    # 2 MB per frame: the 8 MB stack rlimit dies after ~4 calls, well inside
    # the step and wall budgets (small frames recurse too slowly to crash
    # first — zero-init and stack snapshots both grow with depth).
    trace = run(
        """
        int burn(int n) {
            char frame[2000000];
            frame[0] = static_cast<char>(n);
            return frame[0] + burn(n + 1);
        }
        int main() { return burn(0); }
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "stack overflow" in trace.error
    assert trace.steps[-1].event == StepEvent.EXCEPTION


def test_huge_local_array_reports_stack_overflow():
    # ~8.4 MB of locals in main against the 8 MB stack: depth 1, so only the
    # guard-page (si_addr vs $sp) heuristic can classify this one.
    trace = run(
        """
        int main() {
            int big[2100000];
            big[0] = 1;
            big[2099999] = 2;
            return big[0] + big[2099999];
        }
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "stack overflow" in trace.error


def test_null_deref_stays_a_plain_segfault():
    trace = run(
        """
        int main() {
            int *p = nullptr;
            *p = 42;
            return 0;
        }
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "segmentation fault" in trace.error
    assert "stack overflow" not in trace.error
    assert trace.steps[-1].event == StepEvent.EXCEPTION


def test_c_null_deref_gets_the_same_treatment():
    trace = run("int main(void) { int *p = 0; *p = 1; return 0; }", language="c")
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "segmentation fault" in trace.error


# ---- other fatal signals ----------------------------------------------------


def test_division_by_zero_names_the_arithmetic_error():
    trace = run(
        """
        int main() {
            int zero = 0;
            return 7 / zero;
        }
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    assert "arithmetic" in trace.error


def test_malloc_until_death_reports_out_of_memory():
    # One 400 MB memset blows through the 256 MB cgroup in a single step, so
    # the OOM killer fires before reclaim thrash can eat the wall clock.
    trace = run(
        """
        #include <cstdlib>
        #include <cstring>
        int main() {
            const size_t huge = 400UL * 1024 * 1024;
            void *p = std::malloc(huge);
            if (p) std::memset(p, 1, huge);
            return 0;
        }
        """
    )
    assert trace.status == TraceStatus.RUNTIME_ERROR
    # inferior SIGKILLed (traced) or the whole container culled (exit 137) —
    # both must blame memory, not print a cryptic tracer failure
    assert "memory" in trace.error


def test_fork_bomb_is_contained_by_the_pids_limit():
    trace = run(
        """
        #include <unistd.h>
        int main() {
            for (int i = 0; i < 200; ++i) fork();
            return 0;
        }
        """
    )
    # the exact status may vary (ok / timeout / runtime_error) — what matters
    # is that the sandbox returned a trace at all instead of hanging or dying
    assert trace.status in (TraceStatus.OK, TraceStatus.TIMEOUT, TraceStatus.RUNTIME_ERROR)


# ---- output and step limits -------------------------------------------------


def test_output_flood_is_truncated():
    trace = run(
        """
        #include <iostream>
        #include <string>
        int main() {
            std::string chunk(65536, 'x');
            for (int i = 0; i < 160; ++i) std::cout << chunk;
            return 0;
        }
        """
    )
    assert trace.steps
    assert "[output truncated]" in trace.steps[-1].stdout


def test_long_loop_stops_exactly_at_the_step_limit():
    trace = run(
        """
        int main() {
            long total = 0;
            for (int i = 0; i < 5000; ++i) {
                total += i;
            }
            return 0;
        }
        """
    )
    assert trace.status == TraceStatus.STEP_LIMIT
    assert len(trace.steps) == Settings().max_steps
    assert "steps" in trace.error


# ---- compiler abuse ---------------------------------------------------------


def test_template_bomb_fails_as_a_compile_error():
    trace = run(
        """
        template <long N> struct Boom { static const long v = Boom<N + 1>::v; };
        int main() { return static_cast<int>(Boom<0>::v); }
        """
    )
    assert trace.status == TraceStatus.COMPILE_ERROR
    assert trace.error
    assert "/work/" not in trace.error
