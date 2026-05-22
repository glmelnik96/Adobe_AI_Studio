"""POST /auth/recon — запускает Playwright headed логин в фоне.

Защита от двойного вызова — флаг app.state.recon_in_progress.
"""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from loguru import logger

from app import paths
from app.services.playwright_recon import run_recon, ReconError

router = APIRouter()


@router.post("/auth/recon")
async def start_recon(request: Request) -> dict:
    state = request.app.state
    if getattr(state, "recon_task", None) and not state.recon_task.done():
        raise HTTPException(status_code=409, detail={"error": "recon_in_progress"})

    async def _do() -> None:
        try:
            await run_recon(
                user_data_dir=paths.user_data_dir(),
                session_file=paths.session_file(),
                timeout_sec=600,
            )
            # После успешного recon — обновить state.session_bootstrap.session
            bs = state.session_bootstrap
            bs.session = None  # форсим перечитать
            bs.info()
            logger.info("Recon finished, session updated")
        except ReconError as e:
            logger.error(f"Recon failed: {e}")
        except Exception:
            logger.exception("Recon crashed")

    state.recon_task = asyncio.create_task(_do())
    return {"started": True, "hint": "poll GET /health until session_age_sec is set"}
