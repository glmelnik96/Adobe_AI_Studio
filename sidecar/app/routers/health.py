"""GET /health."""
from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/health")
async def health(request: Request) -> dict:
    bs = request.app.state.session_bootstrap
    reg = request.app.state.task_registry

    info = bs.info()
    active = len([s for s in reg.list() if s.status in ("queued", "submitted", "running", "downloading", "uploading", "pending")])

    return {
        "ok": True,
        "session_age_sec": info.session_age_sec,
        "jwt_ttl_sec": info.jwt_ttl_sec,
        "active_jobs": active,
    }
