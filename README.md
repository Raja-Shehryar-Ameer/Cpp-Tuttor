# CppTutor

Step-by-step C++ code visualizer — like [pythontutor.com](https://pythontutor.com), but for C++.

Paste C++ code, click **Visualize**, and scrub through execution: current line highlighted,
stack frames and heap objects drawn as boxes, SVG arrows from pointers to their targets,
stdout revealed incrementally.

## How it works

The backend compiles the code with `g++ -g -O0`, drives it under **GDB/MI** (via `pygdbmi`),
and records a full snapshot of program state after every executed line into a versioned
**trace JSON** ([docs/trace-schema.md](docs/trace-schema.md)). The React frontend is a pure
trace player — it never re-runs code.

All compilation and execution happens inside a locked-down Docker container
(`--network=none`, memory/pid/cpu limits, non-root, read-only rootfs). The host process
never executes user code.

```
React SPA  ── POST /api/trace ──▶  FastAPI  ──▶  Docker(g++ + GDB tracer)  ──▶  trace JSON
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

Note: each trace pays ~1s of Docker container start-up — acceptable for v1.

## Supported C++ subset (v1)

Primitives, fixed-size arrays, C-strings, pointers/references/`nullptr`, functions and
recursion, `struct`/simple `class`, `new`/`delete`/`malloc`/`free` with freed-memory
tracking, `std::string`, `std::vector`, `cin`/`cout`. See [docs/spec.md](docs/spec.md).

## Repository layout

- `backend/` — FastAPI server, GDB tracer, CLI (`cli.py`)
- `frontend/` — React + Vite trace player
- `docker/` — sandbox tracer image
- `samples/` — example programs with golden traces
- `docs/` — spec and trace schema (source of truth)
