"""HTTP boundary. No tracing logic lives here — validate, delegate, return."""

from __future__ import annotations

from typing import Annotated, Literal

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import Settings
from app.models.trace import Trace
from app.services.sandbox import SandboxRunner
from app.services.trace_store import TraceStore

settings = Settings()
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="Shinso API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Trace-Id"],
)


class TraceRequest(BaseModel):
    code: str
    stdin: str = ""
    language: Literal["cpp", "c", "python"] = "cpp"


def get_runner() -> SandboxRunner:
    return SandboxRunner(settings)


def get_store() -> TraceStore:
    return TraceStore(settings.trace_store_dir)


@app.post("/api/trace", response_model=Trace)
@limiter.limit(settings.rate_limit)
def create_trace(
    request: Request,
    response: Response,
    body: TraceRequest,
    runner: Annotated[SandboxRunner, Depends(get_runner)],
    store: Annotated[TraceStore, Depends(get_store)],
) -> Trace:
    if len(body.code.encode()) > settings.max_source_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Source exceeds {settings.max_source_bytes // 1024} KB limit.",
        )
    if len(body.stdin.encode()) > settings.max_stdin_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"stdin exceeds {settings.max_stdin_bytes // 1024} KB limit.",
        )
    trace = runner.run(body.code, body.stdin, body.language)
    response.headers["X-Trace-Id"] = store.save(body.code, body.stdin, trace)
    return trace


@app.get("/api/trace/{trace_id}", response_model=Trace)
def read_trace(trace_id: str, store: Annotated[TraceStore, Depends(get_store)]) -> Trace:
    trace = store.load(trace_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="No trace stored under this link.")
    return trace


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
