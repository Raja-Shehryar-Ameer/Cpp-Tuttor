"""All limits, paths, and flags live in this single Settings object."""

from pathlib import Path

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    max_steps: int = 1000
    wall_timeout_s: int = 25
    output_limit_bytes: int = 64 * 1024
    max_source_bytes: int = 20 * 1024
    max_stdin_bytes: int = 64 * 1024

    docker_image: str = "cpptutor-tracer"
    docker_memory: str = "256m"
    docker_pids_limit: int = 64
    docker_cpus: str = "1.0"
    # Docker's default stack rlimit is unlimited, under which runaway
    # recursion never overflows — it just eats RAM. Pin the Linux default.
    docker_stack_bytes: int = 8 * 1024 * 1024

    rate_limit: str = "10/minute"
    trace_store_dir: Path = Path("trace_store")

    model_config = {"env_prefix": "CPPTUTOR_"}
