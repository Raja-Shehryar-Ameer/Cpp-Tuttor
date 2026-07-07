"""All limits, paths, and flags live in this single Settings object."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    max_steps: int = 1000
    wall_timeout_s: int = 10
    output_limit_bytes: int = 64 * 1024
    max_source_bytes: int = 20 * 1024

    docker_image: str = "cpptutor-tracer"
    docker_memory: str = "256m"
    docker_pids_limit: int = 64
    docker_cpus: str = "0.5"

    rate_limit: str = "10/minute"

    model_config = {"env_prefix": "CPPTUTOR_"}
