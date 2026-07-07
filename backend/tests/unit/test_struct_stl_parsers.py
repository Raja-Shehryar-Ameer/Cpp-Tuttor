"""Struct/STL parser strategies against recorded GDB shapes."""

from app.models.trace import ValueKind
from app.services.value_parser import parse_value
from app.services.value_parser.stl import _vector_element_type
from tests.unit.fakes import FakeEvalContext


def test_struct_parses_fields_recursively():
    ctx = FakeEvalContext(
        values={"(node).value": "7", "(node).next": "0x55aa00", "node": "{...}"},
        addresses={"node": "0x55bb00", "(node).value": "0x55bb00", "(node).next": "0x55bb08"},
        children={"node": [("value", "int"), ("next", "Node *")]},
    )
    value = parse_value("node", "Node", "node", ctx)
    assert value.kind == ValueKind.STRUCT
    assert value.elements is not None
    fields = {e.name: e for e in value.elements}
    assert fields["value"].value == "7"
    assert fields["next"].kind == ValueKind.POINTER
    assert fields["next"].target == "0x55aa00"


def test_struct_without_children_falls_back_to_display():
    ctx = FakeEvalContext(values={"blob": "{raw = 1}"})
    value = parse_value("blob", "Opaque", "blob", ctx)
    assert value.kind == ValueKind.STRUCT
    assert value.value == "{raw = 1}"
    assert value.elements is None


def test_string_uses_pretty_printed_value():
    ctx = FakeEvalContext(values={"s": '"hello"'})
    value = parse_value("s", "std::string", "s", ctx)
    assert value.kind == ValueKind.STRING
    assert value.value == '"hello"'


def test_string_falls_back_to_char_buffer():
    ctx = FakeEvalContext(
        values={"s": "{_M_dataplus = ...}", "(s)._M_dataplus._M_p": '0x55cc00 "hi"'}
    )
    value = parse_value("s", "std::__cxx11::basic_string<char>", "s", ctx)
    assert value.value == '"hi"'


def test_vector_reads_libstdcxx_layout():
    ctx = FakeEvalContext(
        values={
            "(int)((v)._M_impl._M_finish - (v)._M_impl._M_start)": "2",
            "*((v)._M_impl._M_start + 0)": "4",
            "*((v)._M_impl._M_start + 1)": "8",
        }
    )
    value = parse_value("v", "std::vector<int, std::allocator<int> >", "v", ctx)
    assert value.kind == ValueKind.VECTOR
    assert value.elements is not None
    assert [e.value for e in value.elements] == ["4", "8"]
    assert value.elements[0].kind == ValueKind.PRIMITIVE


def test_vector_element_type_extraction():
    assert _vector_element_type("std::vector<int, std::allocator<int> >") == "int"
    assert (
        _vector_element_type("std::vector<std::vector<int>, std::allocator<...> >")
        == "std::vector<int>"
    )
    assert _vector_element_type("std::vector<Node *, std::allocator<Node *> >") == "Node *"
