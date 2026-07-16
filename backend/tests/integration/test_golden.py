"""Golden-file regression tests over every shipped sample.

Regenerate after intentional tracer changes:
    REGEN_GOLDEN=1 pytest tests/integration/test_golden.py -m integration
"""

import json
import os
from pathlib import Path

import pytest

from tests.integration.golden_util import normalize
from tests.integration.test_samples import run_sample

GOLDEN_DIR = Path(__file__).parent / "golden"
ALL_SAMPLES = [
    "basics.cpp",
    "pointers.cpp",
    "arrays.cpp",
    "recursion.cpp",
    "struct_list.cpp",
    "heap_bug.cpp",
    "vector_string.cpp",
    "c/basics.c",
    "c/pointers.c",
    "c/arrays.c",
    "c/recursion.c",
    "c/struct_list.c",
    "c/heap_bug.c",
]

pytestmark = pytest.mark.integration


@pytest.mark.parametrize("sample", ALL_SAMPLES)
def test_sample_matches_golden(sample: str):
    actual = normalize(run_sample(sample))
    stem = sample.replace("/", "_").removesuffix(".cpp").removesuffix(".c")
    golden_path = GOLDEN_DIR / f"{stem}.json"
    if os.environ.get("REGEN_GOLDEN"):
        GOLDEN_DIR.mkdir(exist_ok=True)
        golden_path.write_text(json.dumps(actual, indent=1))
        pytest.skip(f"regenerated {golden_path.name}")
    expected = json.loads(golden_path.read_text())
    assert actual == expected
