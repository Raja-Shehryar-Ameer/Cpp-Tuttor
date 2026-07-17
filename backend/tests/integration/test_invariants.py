"""Structural invariants over real Docker traces of every shipped sample."""

import pytest

from tests.integration.test_golden import ALL_SAMPLES
from tests.integration.test_samples import run_sample
from tests.unit.trace_invariants import assert_trace_invariants

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("sample", ALL_SAMPLES)
def test_sample_trace_invariants(sample: str):
    assert_trace_invariants(run_sample(sample), python=sample.endswith(".py"))
