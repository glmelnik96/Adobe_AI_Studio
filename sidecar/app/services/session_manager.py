"""Тонкая обёртка над vendored refresh_session(): убирает bot-specific
fallback `_find_fresher_recon_dump`, который смотрит в `Phygital-bot/recon/captures/`.

Sidecar не использует recon-fallback — если refresh не прошёл, мы поднимаем
auth_expired и панель показывает кнопку "войти ещё раз" (POST /auth/recon).
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from pathlib import Path

from loguru import logger

from app.phygital_client.auth import RefreshError, refresh_session
from app.phygital_client.session import Session


class SidecarSessionManager:
    """Совместим с интерфейсом PhygitalClient (нужен .refresh(session))."""

    def __init__(self, storage_path: Path) -> None:
        self.storage_path = storage_path
        self._refresh_lock = asyncio.Lock()

    def load(self) -> Session | None:
        if not self.storage_path.exists():
            logger.warning(f"Session file not found: {self.storage_path}")
            return None
        try:
            data = json.loads(self.storage_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            logger.error(f"Session file corrupted: {e}")
            return None
        s = Session(cookies=data.get("cookies", []))
        captured = data.get("captured_at")
        if captured:
            try:
                s.captured_at = datetime.fromisoformat(captured.replace("Z", "+00:00"))
            except Exception:
                pass
        if not s.access_token:
            logger.warning("Session loaded but st-access-token missing")
        return s

    def save(self, session: Session) -> None:
        session.captured_at = datetime.now(timezone.utc)
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "cookies": session.cookies,
            "captured_at": session.captured_at.isoformat(),
        }
        self.storage_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info(f"Session saved -> {self.storage_path}")

    async def refresh(self, session: Session) -> Session:
        """Один refresh, под локом, без recon-fallback'а."""
        async with self._refresh_lock:
            try:
                await refresh_session(session)
            except RefreshError as e:
                logger.warning(f"refresh failed: {e}")
                raise
            self.save(session)
            return session
