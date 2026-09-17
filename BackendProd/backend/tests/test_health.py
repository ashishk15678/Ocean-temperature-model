"""
Tests for GET /health
"""


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["model_loaded"] is True
    assert body["device"] in ("cpu", "cuda", "cuda:0")


def test_health_device_is_string(client):
    r = client.get("/health")
    assert isinstance(r.json()["device"], str)
    assert len(r.json()["device"]) > 0
