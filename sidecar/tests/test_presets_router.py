"""Тесты /presets CRUD — upsert по имени, persist на диск, валидация."""
from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient

from app.main import build_app


@pytest.fixture
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.paths.resolve_app_data", lambda: tmp_path)
    app = build_app()
    with TestClient(app) as c:
        c.app.state.job_runner.schedule = MagicMock()
        yield c


def _mk(name="My preset", **over):
    body = {
        "name": name,
        "family": "video",
        "model_id": 74,
        "scenario": "start_prompt",
        "prompt": "cinematic shot of {subject}",
        "params": {"duration": 5, "aspect_ratio": "16:9"},
    }
    body.update(over)
    return body


# ── CRUD basics ──────────────────────────────────────────────────────────────


def test_list_empty(client):
    r = client.get("/presets")
    assert r.status_code == 200
    assert r.json() == {"presets": []}


def test_create_and_list(client):
    r = client.post("/presets", json=_mk())
    assert r.status_code == 200
    body = r.json()
    assert body["created"] is True
    p = body["preset"]
    assert p["id"]
    assert p["name"] == "My preset"
    assert p["model_id"] == 74
    assert p["params"]["aspect_ratio"] == "16:9"
    assert p["created_at"] and p["updated_at"]

    r2 = client.get("/presets")
    assert [x["name"] for x in r2.json()["presets"]] == ["My preset"]


def test_list_sorted_by_name(client):
    client.post("/presets", json=_mk("zeta"))
    client.post("/presets", json=_mk("Alpha"))
    client.post("/presets", json=_mk("beta"))
    names = [p["name"] for p in client.get("/presets").json()["presets"]]
    assert names == ["Alpha", "beta", "zeta"]


def test_delete(client):
    pid = client.post("/presets", json=_mk()).json()["preset"]["id"]
    r = client.delete(f"/presets/{pid}")
    assert r.status_code == 200
    assert r.json()["ok"] is True
    assert client.get("/presets").json()["presets"] == []


def test_delete_missing_404(client):
    r = client.delete("/presets/nope")
    assert r.status_code == 404
    assert r.json()["detail"]["error"] == "preset_not_found"


# ── upsert по имени ──────────────────────────────────────────────────────────


def test_upsert_same_name_keeps_id_updates_body(client):
    first = client.post("/presets", json=_mk()).json()["preset"]
    r = client.post("/presets", json=_mk(prompt="new prompt", model_id=100))
    body = r.json()
    assert body["created"] is False
    assert body["preset"]["id"] == first["id"]
    assert body["preset"]["prompt"] == "new prompt"
    assert body["preset"]["model_id"] == 100
    assert body["preset"]["created_at"] == first["created_at"]
    assert len(client.get("/presets").json()["presets"]) == 1


def test_upsert_name_match_is_trimmed_case_insensitive(client):
    client.post("/presets", json=_mk("My Preset"))
    r = client.post("/presets", json=_mk("  my preset  "))
    assert r.json()["created"] is False
    assert len(client.get("/presets").json()["presets"]) == 1


# ── валидация ────────────────────────────────────────────────────────────────


def test_empty_name_400(client):
    r = client.post("/presets", json=_mk("   "))
    assert r.status_code == 400
    assert r.json()["detail"]["reason"] == "empty"


def test_too_long_name_400(client):
    r = client.post("/presets", json=_mk("x" * 81))
    assert r.status_code == 400
    assert r.json()["detail"]["reason"] == "too_long"


def test_missing_model_id_422(client):
    r = client.post("/presets", json={"name": "p", "prompt": "hi"})
    assert r.status_code == 422


# ── persistence на диске ─────────────────────────────────────────────────────


def test_persisted_to_user_data_json(client, tmp_path):
    client.post("/presets", json=_mk("Кириллица ок"))
    f = tmp_path / "user_data" / "presets.json"
    assert f.exists()
    data = json.loads(f.read_text(encoding="utf-8"))
    assert data[0]["name"] == "Кириллица ок"


def test_survives_app_restart(tmp_path, monkeypatch):
    monkeypatch.setattr("app.paths.resolve_app_data", lambda: tmp_path)
    with TestClient(build_app()) as c1:
        c1.app.state.job_runner.schedule = MagicMock()
        c1.post("/presets", json=_mk("persistent"))
    with TestClient(build_app()) as c2:
        c2.app.state.job_runner.schedule = MagicMock()
        names = [p["name"] for p in c2.get("/presets").json()["presets"]]
    assert names == ["persistent"]


def test_corrupt_file_starts_empty(client, tmp_path):
    f = tmp_path / "user_data" / "presets.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text("{not json", encoding="utf-8")
    r = client.get("/presets")
    assert r.status_code == 200
    assert r.json()["presets"] == []


# ── /v1 alias ────────────────────────────────────────────────────────────────


def test_v1_prefix_alias(client):
    client.post("/v1/presets", json=_mk("via v1"))
    names = [p["name"] for p in client.get("/presets").json()["presets"]]
    assert names == ["via v1"]
