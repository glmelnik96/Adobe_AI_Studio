"""Тесты perf-улучшений: adaptive polling, параллельный price+submit,
параллельный downloader, TTL-кэш preview-cost."""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import build_app
from app.routers import jobs as jobs_router
from app.services.downloader import download_urls
from app.workflows.base import poll_delay
from app.workflows.image_gen import ImageGenWorkflow


# ── poll_delay schedule ────────────────────────────────────────────────────

def test_poll_delay_fast_start_then_backoff():
    # первые 5 поллов — 0.4s
    assert all(poll_delay(i, 1.5) == 0.4 for i in range(5))
    # следующие 5 — 0.8s
    assert all(poll_delay(i, 1.5) == 0.8 for i in range(5, 10))
    # дальше — base
    assert poll_delay(10, 1.5) == 1.5
    assert poll_delay(100, 1.5) == 1.5


def test_poll_delay_zero_base_for_tests():
    # тесты гоняют wait(poll_interval=0.0) — задержек быть не должно
    assert poll_delay(0, 0.0) == 0.0
    assert poll_delay(7, 0.0) == 0.0
    assert poll_delay(50, 0.0) == 0.0


def test_poll_delay_never_exceeds_base():
    # base меньше ступеней schedule → ступени клампятся
    assert poll_delay(0, 0.2) == 0.2
    assert poll_delay(7, 0.5) == 0.5


# ── параллельный price + submit ────────────────────────────────────────────

def _make_client(price_delay: float = 0.0, submit_delay: float = 0.0):
    client = MagicMock()

    async def _price(payload):
        await asyncio.sleep(price_delay)
        return {"price": 4, "currency": "credits"}

    async def _submit(payload):
        await asyncio.sleep(submit_delay)
        return 12345

    client.get_credits_price = AsyncMock(side_effect=_price)
    client.submit_task = AsyncMock(side_effect=_submit)
    client.post_config_history = AsyncMock(return_value=None)
    return client


async def test_price_and_submit_run_concurrently():
    """price-lookup не должен добавлять serial latency к submit.

    Микро-бенчмарк: price=0.3s, submit=0.3s. Старый код: ~0.6s серийно.
    Новый: ~0.3s (gather). Порог 0.5s — щедрый margin против флака.
    """
    wf = ImageGenWorkflow(_make_client(price_delay=0.3, submit_delay=0.3))
    payload = wf.build_payload(prompt="hi")

    t0 = time.monotonic()
    task_id = await wf.submit(payload)
    elapsed = time.monotonic() - t0

    assert task_id == "12345"
    assert elapsed < 0.5, f"submit took {elapsed:.2f}s — price не параллелится"
    # цена успела и попала в _last_price (→ meta.taskPrice в config_history)
    assert wf._last_price == {"price": 4, "currency": "credits"}
    wf.client.post_config_history.assert_awaited_once()


async def test_price_failure_is_non_fatal():
    client = _make_client()
    client.get_credits_price = AsyncMock(side_effect=RuntimeError("boom"))
    wf = ImageGenWorkflow(client)
    payload = wf.build_payload(prompt="hi")

    task_id = await wf.submit(payload)
    assert task_id == "12345"
    assert wf._last_price is None
    wf.client.post_config_history.assert_awaited_once()


async def test_wait_adaptive_polling_faster_than_fixed():
    """done на 3-м полле: adaptive (0.4+0.4=0.8s sleep) против fixed (2×1.0s)."""
    client = _make_client()
    calls = {"n": 0}

    async def _status(task_id):
        calls["n"] += 1
        if calls["n"] >= 3:
            return {"status": "done", "outputs": [{"name": "image", "id": [1]}]}
        return {"status": "running", "position": 0}

    client.task_status = AsyncMock(side_effect=_status)
    client.get_download_links = AsyncMock(
        return_value=[{"download_link": "https://x/img.png"}]
    )
    wf = ImageGenWorkflow(client)

    t0 = time.monotonic()
    job = await wf.wait("12345", timeout=30.0, poll_interval=1.0)
    elapsed = time.monotonic() - t0

    assert job.status == "completed"
    assert calls["n"] == 3
    # fixed-схема дала бы >= 2.0s; adaptive ~0.8s. Порог с margin.
    assert elapsed < 1.6, f"wait took {elapsed:.2f}s — adaptive polling не работает"


# ── параллельный downloader ────────────────────────────────────────────────

async def test_download_urls_parallel_and_ordered(tmp_path: Path):
    in_flight = {"now": 0, "max": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        in_flight["now"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])
        await asyncio.sleep(0.05)
        in_flight["now"] -= 1
        # тело = последний сегмент url, чтобы проверить порядок
        name = str(request.url).rsplit("/", 1)[-1]
        return httpx.Response(200, content=name.encode(), headers={"Content-Type": "image/png"})

    transport = httpx.MockTransport(handler)
    urls = [f"https://x/file{i}.png" for i in range(4)]
    paths = await download_urls(urls=urls, out_dir=tmp_path / "job", transport=transport)

    assert in_flight["max"] > 1, "downloads не параллелятся"
    # порядок результатов = порядок urls; имена 0001..0004
    assert [p.name for p in paths] == ["0001.png", "0002.png", "0003.png", "0004.png"]
    assert [p.read_bytes().decode() for p in paths] == [
        "file0.png", "file1.png", "file2.png", "file3.png",
    ]


async def test_download_urls_respects_max_concurrency(tmp_path: Path):
    in_flight = {"now": 0, "max": 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        in_flight["now"] += 1
        in_flight["max"] = max(in_flight["max"], in_flight["now"])
        await asyncio.sleep(0.03)
        in_flight["now"] -= 1
        return httpx.Response(200, content=b"x", headers={"Content-Type": "image/png"})

    transport = httpx.MockTransport(handler)
    urls = [f"https://x/f{i}.png" for i in range(8)]
    await download_urls(
        urls=urls, out_dir=tmp_path / "job", transport=transport, max_concurrency=2,
    )
    assert in_flight["max"] <= 2


# ── TTL-кэш preview-cost ───────────────────────────────────────────────────

@pytest.fixture
def client(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("app.paths.resolve_app_data", lambda: tmp_path)
    jobs_router._preview_cost_cache.clear()
    app = build_app()
    with TestClient(app) as c:
        c.app.state.job_runner.schedule = MagicMock()
        yield c
    jobs_router._preview_cost_cache.clear()


def _install_price_client(app, price_mock):
    phygital = MagicMock()
    phygital.get_credits_price = price_mock
    phygital.__aexit__ = AsyncMock(return_value=None)

    async def get_client():
        return phygital

    app.state.get_client = get_client
    return phygital


def test_preview_cost_cached_within_ttl(client):
    price_mock = AsyncMock(return_value={"price": 4})
    _install_price_client(client.app, price_mock)

    body = {"node_id": 94, "params": {"prompt": "hi"}}
    r1 = client.post("/jobs/preview-cost", json=body)
    r2 = client.post("/jobs/preview-cost", json=body)
    assert r1.status_code == 200 and r2.status_code == 200
    assert r1.json() == r2.json() == {"price": 4}
    assert price_mock.await_count == 1, "повторный идентичный запрос не закэширован"


def test_preview_cost_different_params_not_cached(client):
    price_mock = AsyncMock(return_value={"price": 4})
    _install_price_client(client.app, price_mock)

    client.post("/jobs/preview-cost", json={"node_id": 94, "params": {"prompt": "a"}})
    client.post("/jobs/preview-cost", json={"node_id": 94, "params": {"prompt": "b"}})
    assert price_mock.await_count == 2


def test_preview_cost_cache_expires(client, monkeypatch):
    price_mock = AsyncMock(return_value={"price": 4})
    _install_price_client(client.app, price_mock)

    body = {"node_id": 94, "params": {"prompt": "hi"}}
    client.post("/jobs/preview-cost", json=body)
    # форсим истечение TTL: сдвигаем timestamp записи в прошлое
    for k, (ts, v) in list(jobs_router._preview_cost_cache.items()):
        jobs_router._preview_cost_cache[k] = (ts - 120.0, v)
    client.post("/jobs/preview-cost", json=body)
    assert price_mock.await_count == 2


def test_preview_cost_error_not_cached(client):
    price_mock = AsyncMock(side_effect=[RuntimeError("boom"), {"price": 4}])
    _install_price_client(client.app, price_mock)

    body = {"node_id": 94, "params": {"prompt": "hi"}}
    try:
        client.post("/jobs/preview-cost", json=body)
    except RuntimeError:
        pass  # TestClient может пробросить серверное исключение
    r2 = client.post("/jobs/preview-cost", json=body)
    assert r2.status_code == 200
    assert r2.json() == {"price": 4}
    assert price_mock.await_count == 2
