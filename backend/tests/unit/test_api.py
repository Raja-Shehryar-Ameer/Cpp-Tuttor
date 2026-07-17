"""API boundary tests with a stubbed sandbox — no Docker involved."""

import pytest
from fastapi.testclient import TestClient

from app.api.routes import app, get_runner, get_store, settings
from app.models.trace import Trace, TraceStatus
from app.services.trace_store import TraceStore


class StubRunner:
    def __init__(self):
        self.language: str | None = None

    def run(self, code: str, stdin_text: str, language: str = "cpp") -> Trace:
        self.language = language
        return Trace(status=TraceStatus.OK, sourceCode=code, steps=[])


@pytest.fixture()
def client(tmp_path):
    stub = StubRunner()
    app.dependency_overrides[get_runner] = lambda: stub
    app.dependency_overrides[get_store] = lambda: TraceStore(tmp_path)
    limiter = app.state.limiter
    limiter.reset()
    test_client = TestClient(app)
    test_client.stub = stub
    try:
        yield test_client
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


def test_oversized_stdin_rejected(client):
    big = "x" * (settings.max_stdin_bytes + 1)
    response = client.post("/api/trace", json={"code": "int main(){}", "stdin": big})
    assert response.status_code == 413
    assert "stdin" in response.json()["detail"]


def test_missing_code_rejected(client):
    response = client.post("/api/trace", json={"stdin": ""})
    assert response.status_code == 422


def test_language_defaults_to_cpp(client):
    assert client.post("/api/trace", json={"code": "int main(){}"}).status_code == 200
    assert client.stub.language == "cpp"


def test_c_language_passes_through(client):
    response = client.post("/api/trace", json={"code": "int main(void){}", "language": "c"})
    assert response.status_code == 200
    assert client.stub.language == "c"


def test_unknown_language_rejected(client):
    response = client.post("/api/trace", json={"code": "int main(){}", "language": "rust"})
    assert response.status_code == 422


def test_language_echoed_in_trace_payload(client):
    response = client.post("/api/trace", json={"code": "x = 1", "language": "python"})
    assert response.status_code == 200
    assert response.json()["language"] == "python"
    default = client.post("/api/trace", json={"code": "int main(){}"})
    assert default.json()["language"] == "cpp"


def test_stored_trace_without_language_loads_as_null(client, tmp_path):
    # A trace saved before the language field existed must still load (as null).
    legacy_id = "deadbeef01234567"
    (tmp_path / f"{legacy_id}.json").write_text(
        '{"version": 1, "status": "ok", "error": null, "sourceCode": "int main(){}", "steps": []}'
    )
    response = client.get(f"/api/trace/{legacy_id}")
    assert response.status_code == 200
    assert response.json()["language"] is None


def test_permalink_roundtrip(client):
    created = client.post("/api/trace", json={"code": "int main(){}"})
    trace_id = created.headers["X-Trace-Id"]
    assert len(trace_id) == 16
    fetched = client.get(f"/api/trace/{trace_id}")
    assert fetched.status_code == 200
    assert fetched.json()["sourceCode"] == "int main(){}"
    # Language is stamped before the trace is stored, so permalinks carry it.
    assert fetched.json()["language"] == "cpp"


def test_unknown_permalink_404(client):
    assert client.get("/api/trace/deadbeefdeadbeef").status_code == 404
    assert client.get("/api/trace/not-a-valid-id").status_code == 404


def test_corrupt_stored_trace_is_404(client, tmp_path):
    corrupt_id = "cafebabe89abcdef"
    (tmp_path / f"{corrupt_id}.json").write_text("{ this is not json")
    assert client.get(f"/api/trace/{corrupt_id}").status_code == 404


def test_rate_limit_kicks_in(client):
    limit = int(settings.rate_limit.split("/")[0])
    for _ in range(limit):
        assert client.post("/api/trace", json={"code": "int main(){}"}).status_code == 200
    assert client.post("/api/trace", json={"code": "int main(){}"}).status_code == 429
