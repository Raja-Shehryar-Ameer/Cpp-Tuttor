# Shinso

Step-by-step code visualizer for **C++, C, and Python** — like
[pythontutor.com](https://pythontutor.com), but built to go further: real execution
tracing, a `fork()` process-tree visualizer, and interactive data-structure / OS labs
in one place.

Paste code, click **Visualize**, and scrub through execution: current line highlighted,
stack frames and heap objects drawn as boxes, SVG arrows from pointers to their targets,
stdout revealed incrementally. Every trace is shareable via a permalink (`/?t=<id>`).

## The three modes

**1. Execution tracer (C++ / C / Python)** — runs your actual code and records a full
snapshot of program state after every executed line. Stack frames, heap allocations with
stable `H1`/`H2` ids, pointer arrows, uninitialized and freed-memory tracking, stdin/stdout.

**2. C `fork()` visualizer** — write real C code with `fork()` and watch the process
tree grow branch by branch: parent, children, and what each process prints.

**3. Labs** — interactive, animated, quiz-backed (randomized questions, so no
memorizing your way through):

- *Data structures & algorithms:* linked list, stack, queue, BST, AVL, red-black tree,
  min-heap, hash table, B-trees, graphs + graph algorithms, sorting, searching, and a
  head-to-head Sorting Race.
- *Operating systems:* CPU scheduling, threads (ULT vs KLT), page replacement,
  deadlock & Banker's algorithm, disk scheduling.

## How the tracer works

For C and C++, the backend compiles with `g++ -g -O0`, drives the binary under
**GDB/MI** (via `pygdbmi`), and records a versioned **trace JSON**
([docs/trace-schema.md](docs/trace-schema.md) — the source of truth; the backend
Pydantic models and frontend TS types mirror it). Python is traced by a sandboxed
tracer under the same limits. The React frontend is a pure trace player — it never
re-runs code.

All compilation and execution happens inside a locked-down Docker container
(`--network=none`, memory/pid/cpu limits, non-root, read-only rootfs). The host process
never executes user code — fork bombs and infinite loops are contained and turned into
student-readable errors (see `backend/tests/integration/test_adversarial.py`).

```
React SPA  ── POST /api/trace ──▶  FastAPI  ──▶  Docker(g++ + GDB / Python tracer)  ──▶  trace JSON
```

## Quick start

```bash
# 1. Build the tracer image (requires Docker)
docker build -t cpptutor-tracer -f docker/Dockerfile.tracer .

# 2. Trace a sample from the CLI
cd backend
pip install -e .[dev]
python cli.py ../samples/pointers.cpp > trace.json

# 3. Run the API
uvicorn app.api.routes:app --reload

# 4. Run the frontend
cd ../frontend && npm install && npm run dev
```

Note: each trace pays ~1s of Docker container start-up.

## Supported language subset

C++/C: primitives, fixed-size arrays, C-strings, pointers/references/`nullptr`,
functions and recursion, `struct`/simple `class`, `new`/`delete`/`malloc`/`free` with
freed-memory tracking, `std::string`, `std::vector`, `cin`/`cout`, `fork()` (C).
Python: functions, closures, containers, objects — traced with the same step model.

## Repository layout

- `backend/` — FastAPI server, GDB tracer, Python tracer, CLI (`cli.py`)
- `frontend/` — React + Vite trace player, labs, fork visualizer
- `docker/` — sandbox tracer image
- `samples/` — example programs (C++, C, Python) with golden traces
- `docs/` — trace schema (source of truth)
