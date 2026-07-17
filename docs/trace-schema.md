# Trace JSON Schema (version 1)

Single source of truth for the contract between backend and frontend.
Mirrored by `backend/app/models/trace.py` (pydantic) and `frontend/src/types/trace.ts`.
Any change lands here first, then in both mirrors, in the same commit.

## Top level

| Field | Type | Notes |
|---|---|---|
| `version` | `1` | Schema version literal |
| `language` | `"cpp" \| "c" \| "python" \| null` | Set by the API from the request; `null` on traces stored before this field existed (UI treats `null` as C-like) |
| `status` | `"ok" \| "compile_error" \| "runtime_error" \| "timeout" \| "step_limit"` | |
| `error` | `string \| null` | Human-readable message when `status != "ok"` |
| `sourceCode` | `string` | Echoed back for the player |
| `steps` | `Step[]` | Empty when `status == "compile_error"` |

## Step

| Field | Type | Notes |
|---|---|---|
| `line` | `number` | 1-based line about to execute |
| `event` | `"call" \| "return" \| "step" \| "exception" \| "exit"` | |
| `functionName` | `string` | Innermost frame's function |
| `stdout` | `string` | **Cumulative** stdout up to this step |
| `stack` | `Frame[]` | Outermost (`main`) last |
| `heap` | `HeapObject[]` | Full heap view at this step |

## Frame

| Field | Type |
|---|---|
| `frameId` | `string` (numbered from the bottom: `"f0"` = outermost, i.e. `main` / `<module>`) |
| `functionName` | `string` |
| `line` | `number` |
| `locals` | `Value[]` |

## Value (recursive — same shape at every nesting depth)

| Field | Type | Notes |
|---|---|---|
| `name` | `string` | Variable/field/element name (`"[0]"` for elements) |
| `type` | `string` | C++ type as reported by GDB |
| `kind` | `"primitive" \| "pointer" \| "array" \| "struct" \| "string" \| "vector"` | Drives rendering |
| `value` | `string \| null` | Display string for primitive/string/pointer |
| `address` | `string \| null` | Opaque; arrow endpoint / heap key. Never parsed. |
| `target` | `string \| null` | kind=pointer only: pointee address, or null for nullptr |
| `elements` | `Value[] \| null` | array/vector/struct children |
| `isInitialized` | `boolean` | False → render as `?` |

## HeapObject

| Field | Type | Notes |
|---|---|---|
| `address` | `string` | Key for arrows |
| `label` | `string` | e.g. `"int[4]"`, `"Node"` |
| `kind` | Value kind | |
| `elements` | `Value[]` | Contents |
| `freed` | `boolean` | True after delete/free → render greyed-out |

## Rules

- Addresses are opaque strings used only as arrow endpoints and heap keys.
- `stdout` is cumulative per step so the player can jump anywhere without replay.
- Every `Value` uses the same recursive shape; one renderer handles everything.
- Python traces: `freed` is never true and `Value.address` is always null —
  memory is managed automatically; the UI shows reference badges, not addresses.
