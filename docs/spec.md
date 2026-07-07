# Build Prompt: CppTutor — Step-by-Step C++ Code Visualizer

You are an expert full-stack engineer. Build **CppTutor**, a web application that visually executes C++ programs step by step, like pythontutor.com but for C++. Follow this spec exactly. Where the spec is silent, choose the simplest solution that keeps code reusable.

---

## 1. Product Goal

A student pastes C++ code into a browser editor, clicks **Visualize**, and gets:

- The code with the **current line highlighted**
- A **step slider** and prev/next buttons to scrub through execution
- A **memory diagram**: stack frames as boxes, heap allocations in a separate region, and **SVG arrows from pointers to their targets**
- Program **stdout** shown incrementally as steps advance

The backend executes the code once, records a full snapshot of program state after every executed line, and returns a **trace** (JSON). The frontend is a pure trace player — it never re-runs code.

---

## 2. Scope

### Supported C++ subset (v1)

- Primitive types: `int`, `long`, `float`, `double`, `char`, `bool`
- Fixed-size arrays, C-strings
- Pointers, references, `nullptr`, pointer arithmetic
- Functions, recursion, pass-by-value / pointer / reference
- `struct` and simple `class` (public fields, methods)
- `new` / `delete`, `malloc` / `free` (heap tracking)
- `std::string` and `std::vector` (rendered via GDB pretty-printers)
- `cin` via pre-supplied stdin textbox; `cout` capture

### Explicit non-goals (v1)

- Templates beyond `std::vector`/`std::string`, STL internals, smart pointers, threads, exceptions-as-visualization, multiple translation units, user file I/O, networking

Show unsupported-feature failures as a **clear user-facing message**, never a stack trace.

---

## 3. Architecture

```
┌──────────────┐   POST /api/trace    ┌───────────────────────────────┐
│ React SPA    │ ───────────────────▶ │ FastAPI server                │
│ (trace       │ ◀─────────────────── │  ├─ CompileService (g++)      │
│  player)     │     trace JSON       │  ├─ TraceService (GDB driver) │
└──────────────┘                      │  └─ SandboxRunner (Docker)    │
                                      └───────────────────────────────┘
```

Two independent deliverables joined only by the **trace JSON contract** (Section 4). Build and test the backend as a CLI tool first; the web layer is a thin wrapper.

### Tech stack

| Layer | Choice |
|---|---|
| Backend | Python 3.11+, FastAPI, `pygdbmi` |
| Execution | `g++ -g -O0 -fno-omit-frame-pointer`, GDB/MI, Docker sandbox |
| Frontend | React + Vite, CodeMirror 6, plain SVG for arrows, Zustand for state |
| Trace format | JSON, versioned (`"version": 1`) |

---

## 4. Trace JSON Contract (single source of truth)

Define this schema in **one shared document** (`docs/trace-schema.md`) plus a TypeScript type file and a Python `dataclass`/`pydantic` model. Backend and frontend both import their respective definitions — never duplicate ad-hoc shapes.

```jsonc
{
  "version": 1,
  "status": "ok",                    // "ok" | "compile_error" | "runtime_error" | "timeout" | "step_limit"
  "error": null,                     // human-readable message when status != "ok"
  "sourceCode": "...",               // echoed back for the player
  "steps": [
    {
      "line": 7,                     // 1-based line about to execute / just executed
      "event": "step",               // "call" | "return" | "step" | "exception" | "exit"
      "functionName": "main",
      "stdout": "sum = 3\n",         // cumulative stdout up to this step
      "stack": [
        {
          "frameId": "f0",
          "functionName": "main",
          "line": 7,
          "locals": [
            {
              "name": "x",
              "type": "int",
              "kind": "primitive",   // "primitive" | "pointer" | "array" | "struct" | "string" | "vector"
              "value": "3",          // display string for primitives
              "address": "0x7ffd...",
              "target": null,        // for kind=pointer: address it points to, or null
              "elements": null,      // for array/vector/struct: nested Value objects
              "isInitialized": true
            }
          ]
        }
      ],
      "heap": [
        {
          "address": "0x5591...",
          "label": "int[4]",
          "kind": "array",
          "elements": [ /* Value objects */ ],
          "freed": false             // true after delete/free → render greyed-out
        }
      ]
    }
  ]
}
```

Rules:

- Every `Value` uses the **same recursive shape** at all nesting depths. One renderer handles everything.
- Addresses are opaque strings used only as arrow endpoints and heap keys. Never parse them.
- `stdout` is cumulative per step so the player can jump to any step without replay logic.

---

## 5. Backend Specification

### 5.1 Package layout

```
backend/
  app/
    api/routes.py            # FastAPI endpoints only — no logic
    core/config.py           # limits, paths, flags (single Settings object)
    models/trace.py          # pydantic models mirroring the schema
    services/
      compile_service.py     # source → binary (or CompileError)
      gdb_driver.py          # low-level pygdbmi wrapper (Facade)
      value_parser/          # GDB value → Value model (Strategy per kind)
        base.py              # ValueParser ABC + registry
        primitive.py
        pointer.py
        array.py
        struct_.py
        stl.py               # std::string, std::vector
      trace_service.py       # orchestrates: step loop → Step list
      sandbox.py             # Docker run wrapper with limits
  cli.py                     # `python cli.py file.cpp` → trace.json (Phase 1 deliverable)
  tests/
```

### 5.2 Design patterns — use exactly these, where stated, and no others

| Pattern | Where | Why |
|---|---|---|
| **Facade** | `gdb_driver.GdbSession` | Hide pygdbmi/MI ugliness behind ~8 methods: `start()`, `set_breakpoint()`, `step()`, `next()`, `get_stack()`, `get_locals(frame)`, `evaluate(expr)`, `stop()`. Nothing outside this file touches pygdbmi. |
| **Strategy + Registry** | `value_parser/` | One parser class per `kind`. A registry maps GDB type signatures → parser. Adding `std::map` later = one new file, zero edits elsewhere. |
| **Template Method** | `ValueParser.parse()` | Base class handles name/type/address extraction; subclasses implement `parse_payload()`. |
| **Builder** | `trace_service.TraceBuilder` | Accumulates steps, enforces step limit, finalizes status. Keeps the step loop readable. |
| **Dependency injection (plain constructors)** | services | `TraceService(compiler, gdb_factory, settings)` — no globals, trivially testable with fakes. |

Do **not** add patterns for their own sake (no abstract factories over the factory, no singletons — use FastAPI dependency wiring).

### 5.3 Trace algorithm

1. Compile: `g++ -g -O0 -fno-omit-frame-pointer -o prog main.cpp` (in temp dir). On failure return `compile_error` with the compiler message, filtered to remove file paths.
2. Start GDB in MI mode on the binary, `break main`, `run` with redirected stdin/stdout files.
3. Loop until exit / limits:
   - Read current line + frame info.
   - Snapshot all frames: for each frame, list locals, parse each via the parser registry (recursively following pointers **one level** into heap objects).
   - Track heap: intercept `new`/`malloc`/`delete`/`free` via breakpoints on allocator symbols; maintain an address → HeapObject map, marking `freed` instead of deleting entries.
   - Read the stdout file, store cumulative content.
   - Append step; `step` into user functions, `next` over library calls (decide via source-file path of the frame).
4. Hard limits from `Settings`: `MAX_STEPS = 1000`, `WALL_TIMEOUT_S = 10`, `OUTPUT_LIMIT = 64 KiB`. Exceeding any → truncate with matching `status`.

### 5.4 Sandbox (non-negotiable)

All compile + run happens inside a Docker container:

- `--network=none`, `--memory=256m`, `--pids-limit=64`, `--cpus=0.5`, read-only rootfs with a writable `/work` tmpfs, non-root user, wall-clock kill at timeout.
- The FastAPI process never executes user code directly. `SandboxRunner.run(source, stdin) -> RawArtifacts` is the only entry point.

### 5.5 API

- `POST /api/trace` — body `{ "code": str, "stdin": str }` → trace JSON. Rate-limit per IP (e.g. 10/min). Reject code > 20 KB.
- `GET /api/health`

Routes contain zero logic: validate → call `TraceService` → return.

---

## 6. Frontend Specification

### 6.1 Layout

Three-pane responsive layout: editor (left), memory diagram (right), controls + stdout (bottom). Diagram splits into **Stack** and **Heap** columns.

### 6.2 Component structure

```
src/
  types/trace.ts             # generated/mirrored from trace-schema.md
  store/traceStore.ts        # Zustand: trace, currentStep, playState
  api/client.ts              # single fetch wrapper
  components/
    EditorPane.tsx           # CodeMirror, read-only during playback, line highlight
    Controls.tsx             # slider, prev/next, play/pause, speed
    StdoutPane.tsx
    diagram/
      MemoryDiagram.tsx      # layout + arrow overlay orchestration
      StackFrame.tsx
      HeapRegion.tsx
      ValueBox.tsx           # ONE recursive component renders every Value kind
      ArrowLayer.tsx         # SVG overlay; reads DOM rects of source/target boxes
  hooks/
    usePlayback.ts           # timer-driven autoplay
    useArrowPositions.ts     # measure boxes via refs + ResizeObserver
```

### 6.3 Rules

- **`ValueBox` is recursive and kind-driven** — a lookup table `kind → sub-renderer`, mirroring the backend Strategy. No `if (name === ...)` special cases.
- Arrows: each `ValueBox` with an `address` registers its DOM rect in the store keyed by address; `ArrowLayer` draws cubic-bezier SVG paths from `pointer.address` → `target`. Dangling pointers (target not found or `freed`) render red with a ⚠ marker.
- Freed heap objects render greyed-out with strikethrough label — this teaches use-after-free visually.
- Step changes must be **pure re-renders from the store** — no imperative DOM mutation outside `ArrowLayer` measurements.
- Keyboard: `←`/`→` step, `space` play/pause.

---

## 7. Coding Standards (apply to all code)

- Clean, self-documenting names; **comments only where intent isn't obvious** — one line, above the code, explaining *why*, never *what*.
- Functions ≤ ~40 lines; files ≤ ~300 lines; split before exceeding.
- No dead code, no commented-out blocks, no TODOs without an issue reference.
- Python: type hints everywhere, `ruff` + `black` clean, pydantic for all cross-boundary data.
- TypeScript: `strict: true`, no `any` (use `unknown` + narrowing), exhaustive `switch` on `kind` with a `never` guard.
- Errors: raise/throw typed errors at the source, convert to user-facing messages at the boundary (route handler / API client) only.
- Every service class gets a fake/stub for tests; no test may spawn real GDB except integration tests under `tests/integration/`.

---

## 8. Build Phases (deliver in order, each independently runnable)

1. **CLI tracer** — `python cli.py samples/pointers.cpp > trace.json`. Primitives + pointers + arrays + functions. Unit tests on parser strategies with recorded GDB fixtures.
2. **Heap + structs + STL** — allocator breakpoints, `struct`, `std::string`/`std::vector` pretty-printing, freed-memory tracking.
3. **Sandbox + API** — Docker runner, FastAPI endpoint, limits, error statuses.
4. **Trace player frontend** — loads a static `trace.json` first (no backend needed), then wire to the API.
5. **Polish** — dangling-pointer highlighting, autoplay, shareable permalink (trace stored server-side by hash), example gallery (recursion, linked list, use-after-free demo).

Acceptance test for the whole system: a linked-list insertion program visualizes correctly with arrows updating each step, and a use-after-free sample shows the freed node greyed with a red dangling arrow.

---

## 9. Sample Programs to Ship (`samples/`)

`basics.cpp` (vars, arithmetic), `pointers.cpp`, `arrays.cpp`, `recursion.cpp` (factorial), `struct_list.cpp` (manual linked list), `heap_bug.cpp` (use-after-free), `vector_string.cpp`.

Each sample must produce a stable trace used as a golden file in integration tests.