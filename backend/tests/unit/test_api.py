"""API boundary tests with a stubbed sandbox — no Docker involved."""

import pytest
from fastapi.testclient import TestClient

from app.api.routes import app, get_runner, settings
from app.models.trace import Trace, TraceStatus


class StubRunner:
    def run(self, code: str, stdin_text: str) -> Trace:
        return Trace(status=TraceStatus.OK, sourceCode=code, steps=[])


@pytest.fixture()
def client():
    app.dependency_overrides[get_runner] = lambda: StubRunner()
    limiter = app.state.limiter
    limiter.reset()
    try:
        yield TestClient(app)
    finally:
        app.dependency_overrides.clear()


def test_health(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_trace_roundtrip(client):
    response = client.post("/api/trace", json={"code": "int main(){}", "stdin": ""})
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert body["sourceCode"] == "int main(){}"
    assert body["version"] == 1


def test_oversized_source_rejected(client):
    big = "x" * (settings.max_source_bytes + 1)
    response = client.post("/api/trace", json={"code": big})
    assert response.status_code == 413
    assert "KB limit" in response.json()["detail"]


def test_missing_code_rejected(client):
    response = client.post("/api/trace", json={"stdin": ""})
    assert response.status_code == 422


def test_rate_limit_kicks_in(client):
    limit = int(settings.rate_limit.split("/")[0])
    for _ in range(limit):
        assert client.post("/api/trace", json={"code": "int main(){}"}).status_code == 200
    assert client.post("/api/trace", json={"code": "int main(){}"}).status_code == 429
