"""Pydantic mirror of docs/trace-schema.md. Change the doc first, then this."""

from __future__ import annotations

from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, Field


class TraceStatus(StrEnum):
    OK = "ok"
    COMPILE_ERROR = "compile_error"
    RUNTIME_ERROR = "runtime_error"
    TIMEOUT = "timeout"
    STEP_LIMIT = "step_limit"


class StepEvent(StrEnum):
    CALL = "call"
    RETURN = "return"
    STEP = "step"
    EXCEPTION = "exception"
    EXIT = "exit"


class ValueKind(StrEnum):
    PRIMITIVE = "primitive"
    POINTER = "pointer"
    ARRAY = "array"
    STRUCT = "struct"
    STRING = "string"
    VECTOR = "vector"


class Value(BaseModel):
    name: str
    type: str
    kind: ValueKind
    value: str | None = None
    address: str | None = None
    target: str | None = None
    elements: list[Value] | None = None
    isInitialized: bool = True


class Frame(BaseModel):
    frameId: str
    functionName: str
    line: int
    locals: list[Value]


class HeapObject(BaseModel):
    address: str
    label: str
    kind: ValueKind
    elements: list[Value]
    freed: bool = False


class Step(BaseModel):
    line: int
    event: StepEvent
    functionName: str
    stdout: str
    stack: list[Frame]
    heap: list[HeapObject]


class Trace(BaseModel):
    version: Literal[1] = 1
    # None only on traces stored before the field existed; set at the API boundary.
    language: Literal["cpp", "c", "python"] | None = None
    status: TraceStatus
    error: str | None = None
    sourceCode: str
    steps: list[Step] = Field(default_factory=list)
