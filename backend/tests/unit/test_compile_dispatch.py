"""CompileService toolchain dispatch — subprocess is faked, no compiler runs."""

import subprocess

import pytest

from app.services.compile_service import CompileError, CompileService


class FakeResult:
    returncode = 0
    stderr = ""


def record_argv(monkeypatch):
    seen = {}

    def fake_run(cmd, **kwargs):
        seen["cmd"] = cmd
        return FakeResult()

    monkeypatch.setattr(subprocess, "run", fake_run)
    return seen


def test_cpp_source_uses_gxx(monkeypatch, tmp_path):
    seen = record_argv(monkeypatch)
    source = tmp_path / "main.cpp"
    source.write_text("int main() {}")
    CompileService().compile(source, tmp_path)
    assert seen["cmd"][0] == "g++"
    assert "-std=c++17" in seen["cmd"]


def test_c_source_uses_gcc(monkeypatch, tmp_path):
    seen = record_argv(monkeypatch)
    source = tmp_path / "main.c"
    source.write_text("int main(void) {}")
    CompileService().compile(source, tmp_path)
    assert seen["cmd"][0] == "gcc"
    assert "-std=c17" in seen["cmd"]
    assert "-ftrivial-auto-var-init=zero" in seen["cmd"]


def test_compile_timeout_becomes_compile_error(monkeypatch, tmp_path):
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, 30)

    monkeypatch.setattr(subprocess, "run", fake_run)
    source = tmp_path / "main.cpp"
    source.write_text("int main() {}")
    with pytest.raises(CompileError, match="30 s"):
        CompileService().compile(source, tmp_path)
