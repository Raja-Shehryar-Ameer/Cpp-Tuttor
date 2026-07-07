"""HTTP boundary. No tracing logic lives here — validate, delegate, return."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import Settings
from app.models.trace import Trace
from app.services.sandbox import SandboxRunner

settings = Settings()
limiter = Limiter(key_func=get_remote_address)

app = FastAPI(title="CppTutor API")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class TraceRequest(BaseModel):
    code: str
    stdin: str = ""


def get_runner() -> SandboxRunner:
    return SandboxRunner(settings)


@app.post("/api/trace", response_model=Trace)
@limiter.limit(settings.rate_limit)
def create_trace(
    request: Request,
    body: TraceRequest,
    runner: Annotated[SandboxRunner, Depends(get_runner)],
) -> Trace:
    if len(body.code.encode()) > settings.max_source_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"Source exceeds {settings.max_source_bytes // 1024} KB limit.",
        )
    return runner.run(body.code, body.stdin)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
