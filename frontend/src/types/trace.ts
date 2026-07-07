// Mirrors docs/trace-schema.md. Change the doc first, then this file.

export type TraceStatus = "ok" | "compile_error" | "runtime_error" | "timeout" | "step_limit";

export type StepEvent = "call" | "return" | "step" | "exception" | "exit";

export type ValueKind = "primitive" | "pointer" | "array" | "struct" | "string" | "vector";

export interface Value {
  name: string;
  type: string;
  kind: ValueKind;
  value: string | null;
  address: string | null;
  target: string | null;
  elements: Value[] | null;
  isInitialized: boolean;
}

export interface Frame {
  frameId: string;
  functionName: string;
  line: number;
  locals: Value[];
}

export interface HeapObject {
  address: string;
  label: string;
  kind: ValueKind;
  elements: Value[];
  freed: boolean;
}

export interface Step {
  line: number;
  event: StepEvent;
  functionName: string;
  stdout: string;
  stack: Frame[];
  heap: HeapObject[];
}

export interface Trace {
  version: 1;
  status: TraceStatus;
  error: string | null;
  sourceCode: string;
  steps: Step[];
}
