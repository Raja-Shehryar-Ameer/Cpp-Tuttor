"""Parser strategy tests against recorded GDB value strings."""

from app.models.trace import ValueKind
from app.services.value_parser import parse_value
from app.services.value_parser.base import parser_for
from tests.unit.fakes import FakeEvalContext


def test_registry_classifies_type_signatures():
    assert parser_for("int").kind == ValueKind.PRIMITIVE
    assert parser_for("unsigned long").kind == ValueKind.PRIMITIVE
    assert parser_for("int *").kind == ValueKind.POINTER
    assert parser_for("char *").kind == ValueKind.POINTER
    assert parser_for("int [4]").kind == ValueKind.ARRAY
    assert parser_for("int [2][3]").kind == ValueKind.ARRAY
    assert parser_for("Node").kind == ValueKind.STRUCT  # fallback until Phase 2


def test_primitive_parse():
    ctx = FakeEvalContext({"x": "42"}, {"x": "0x7ffd0001"})
    value = parse_value("x", "int", "x", ctx)
    assert value.kind == ValueKind.PRIMITIVE
    assert value.value == "42"
    assert value.address == "0x7ffd0001"
    assert value.elements is None


def test_reference_renders_as_referent():
    ctx = FakeEvalContext({"r": "7"}, {"r": "0x7ffd0002"})
    value = parse_value("r", "int &", "r", ctx)
    assert value.kind == ValueKind.PRIMITIVE
    assert value.value == "7"


def test_pointer_parse_with_target():
    ctx = FakeEvalContext({"p": "0x7ffd00aa"}, {"p": "0x7ffd00bb"})
    value = parse_value("p", "int *", "p", ctx)
    assert value.kind == ValueKind.POINTER
    assert value.target == "0x7ffd00aa"
    assert value.address == "0x7ffd00bb"


def test_null_pointer_has_no_target():
    ctx = FakeEvalContext({"q": "0x0"})
    value = parse_value("q", "int *", "q", ctx)
    assert value.target is None


def test_char_pointer_keeps_string_display():
    ctx = FakeEvalContext({"s": '0x55910f2a "hello"'})
    value = parse_value("s", "char *", "s", ctx)
    assert value.target == "0x55910f2a"
    assert "hello" in (value.value or "")


def test_array_parse_recurses_into_elements():
    ctx = FakeEvalContext(
        values={"(nums)[0]": "5", "(nums)[1]": "8", "(nums)[2]": "13"},
        addresses={"nums": "0x7ffd0100", "(nums)[0]": "0x7ffd0100", "(nums)[1]": "0x7ffd0104"},
    )
    value = parse_value("nums", "int [3]", "nums", ctx)
    assert value.kind == ValueKind.ARRAY
    assert value.elements is not None
    assert [e.value for e in value.elements] == ["5", "8", "13"]
    assert value.elements[0].kind == ValueKind.PRIMITIVE
    assert value.elements[1].address == "0x7ffd0104"


def test_nested_array_element_type():
    ctx = FakeEvalContext(
        values={f"((grid)[{i}])[{j}]": str(i * 10 + j) for i in range(2) for j in range(3)}
    )
    value = parse_value("grid", "int [2][3]", "grid", ctx)
    assert value.elements is not None and len(value.elements) == 2
    row = value.elements[0]
    assert row.kind == ValueKind.ARRAY
    assert row.elements is not None
    assert [e.value for e in row.elements] == ["0", "1", "2"]


def test_unavailable_value_degrades_gracefully():
    ctx = FakeEvalContext({})
    value = parse_value("x", "int", "x", ctx)
    assert value.value == "<unavailable>"
