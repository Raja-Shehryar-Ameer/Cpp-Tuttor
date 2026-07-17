"""Host-side Docker wrapper: the ONLY way user code gets compiled or executed."""

from __future__ import annotations

import json
import subprocess
import uuid

from app.core.config import Settings
from app.models.trace import Trace, TraceStatus


class SandboxRunner:
    def __init__(self, settings: Settings):
        self._settings = settings

    def run(self, code: str, stdin_text: str, language: str = "cpp") -> Trace:
        s = self._settings
        name = f"cpptutor-{uuid.uuid4().hex[:12]}"
        cmd = [
            "docker",
            "run",
            "--rm",
            "-i",
            "--name",
            name,
            "--network=none",
            "--memory",
            s.docker_memory,
            # Without this Docker grants an equal swap allowance on top, so
            # "out of memory" turns into minutes of swap thrash instead.
            "--memory-swap",
            s.docker_memory,
            "--pids-limit",
            str(s.docker_pids_limit),
            "--cpus",
            s.docker_cpus,
            "--ulimit",
            f"stack={s.docker_stack_bytes}:{s.docker_stack_bytes}",
            "--read-only",
            # exec: the compiled student binary lives (and runs) in this tmpfs.
            "--tmpfs",
            "/work:rw,exec,size=64m",
            "--tmpfs",
            "/tmp:rw,size=16m",
            s.docker_image,
        ]
        payload = json.dumps({"code": code, "stdin": stdin_text, "language": language})
        try:
            # Grace period on top of the tracer's own wall clock, then hard kill.
            result = subprocess.run(
                cmd,
                input=payload,
                capture_output=True,
                text=True,
                # The tracer speaks UTF-8 on both pipes; without this Windows
                # hosts encode with cp1252 and non-ASCII source breaks JSON.
                encoding="utf-8",
                errors="replace",
                timeout=s.wall_timeout_s * 2 + 15,
            )
        except subprocess.TimeoutExpired:
            subprocess.run(["docker", "rm", "-f", name], capture_output=True)
            return self._error_trace(
                code, TraceStatus.TIMEOUT, f"Program took longer than {s.wall_timeout_s}s."
            )
        except FileNotFoundError:
            return self._error_trace(
                code, TraceStatus.RUNTIME_ERROR, "Execution backend is unavailable."
            )

        try:
            return Trace.model_validate_json(result.stdout)
        except ValueError:
            # 137 = SIGKILL of the container itself: the cgroup limit was hit
            # hard enough to take GDB down with the program. (`docker inspect`
            # would confirm OOMKilled, but --rm makes that racy.)
            if result.returncode == 137:
                return self._error_trace(
                    code,
                    TraceStatus.RUNTIME_ERROR,
                    "The program ran out of memory (256 MB limit) and was killed.",
                )
            # `docker run` with an absent image fails before any tracing starts;
            # without this branch it reads as a tracer bug instead of a setup one.
            image_missing = ("Unable to find image", "pull access denied", "No such image")
            if any(marker in result.stderr for marker in image_missing):
                return self._error_trace(
                    code,
                    TraceStatus.RUNTIME_ERROR,
                    "Execution backend is unavailable — the tracer image is not built.",
                )
            return self._error_trace(
                code, TraceStatus.RUNTIME_ERROR, "The tracer produced no usable output."
            )

    @staticmethod
    def _error_trace(code: str, status: TraceStatus, message: str) -> Trace:
        return Trace(status=status, error=message, sourceCode=code)
