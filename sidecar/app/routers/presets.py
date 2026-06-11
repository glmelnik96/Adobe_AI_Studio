"""CRUD пресетов формы генерации — GET/POST /presets, DELETE /presets/{id}.

Пресет = «только форма»: family, model_id, scenario, prompt-шаблон, params.
Файлы/слоты намеренно НЕ сохраняются — пользователь подбирает референсы
каждый раз (см. дизайн V1.3 presets).

Хранение — presets.json в user_data_dir(): общий для Pr- и AE-панелей,
переживает чистку CEP-кэша, переносится файлом. Sidecar однопроцессный,
запись идёт атомарно (tmp + replace), так что file-lock не нужен.

Upsert по имени: POST с уже существующим именем (case-insensitive, trim)
перезаписывает содержимое пресета, сохраняя его id — «Save preset» с тем же
именем в панели обновляет, а не плодит дубли.
"""
from __future__ import annotations

import json
import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from loguru import logger
from pydantic import BaseModel, Field

from app import paths

router = APIRouter()

_MAX_PRESETS = 200
_MAX_NAME_LEN = 80


def _presets_file() -> Path:
    return paths.user_data_dir() / "presets.json"


def _load() -> list[dict]:
    f = _presets_file()
    if not f.exists():
        return []
    try:
        data = json.loads(f.read_text(encoding="utf-8"))
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError) as e:
        # Битый файл не должен ронять весь CRUD; стартуем с пустого списка,
        # но не перезаписываем битый файл до первой успешной записи.
        logger.warning(f"presets.json unreadable, starting empty: {e}")
        return []


def _save(items: list[dict]) -> None:
    f = _presets_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, f)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class PresetIn(BaseModel):
    name: str
    family: str | None = None          # 'image' | 'video' | 'upscale' | 'voice'
    model_id: int
    scenario: str | None = None
    prompt: str = ""
    params: dict = Field(default_factory=dict)


@router.get("/presets")
async def list_presets() -> dict:
    items = _load()
    items.sort(key=lambda p: str(p.get("name", "")).lower())
    return {"presets": items}


@router.post("/presets")
async def save_preset(req: PresetIn) -> dict:
    name = req.name.strip()
    if not name:
        raise HTTPException(400, detail={"error": "bad_name", "reason": "empty"})
    if len(name) > _MAX_NAME_LEN:
        raise HTTPException(400, detail={
            "error": "bad_name", "reason": "too_long", "max": _MAX_NAME_LEN,
        })

    items = _load()
    now = _now_iso()
    body = {
        "name": name,
        "family": req.family,
        "model_id": req.model_id,
        "scenario": req.scenario,
        "prompt": req.prompt,
        "params": req.params,
        "updated_at": now,
    }

    existing = next(
        (p for p in items if str(p.get("name", "")).strip().lower() == name.lower()),
        None,
    )
    if existing is not None:
        existing.update(body)
        preset, created = existing, False
    else:
        if len(items) >= _MAX_PRESETS:
            raise HTTPException(400, detail={
                "error": "too_many_presets", "max": _MAX_PRESETS,
            })
        preset = {"id": uuid.uuid4().hex, "created_at": now, **body}
        items.append(preset)
        created = True

    try:
        _save(items)
    except OSError as e:
        logger.error(f"presets.json write failed: {e}")
        raise HTTPException(500, detail={"error": "presets_write_failed"})
    return {"preset": preset, "created": created}


@router.delete("/presets/{preset_id}")
async def delete_preset(preset_id: str) -> dict:
    items = _load()
    kept = [p for p in items if p.get("id") != preset_id]
    if len(kept) == len(items):
        raise HTTPException(404, detail={"error": "preset_not_found", "id": preset_id})
    try:
        _save(kept)
    except OSError as e:
        logger.error(f"presets.json write failed: {e}")
        raise HTTPException(500, detail={"error": "presets_write_failed"})
    return {"ok": True, "id": preset_id}
