"""/assets endpoints — sha256-cached file uploads to Phygital+."""
from __future__ import annotations

import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, Request, Response, UploadFile

from app import paths

router = APIRouter()


@router.post("/assets")
async def upload_asset(request: Request, file: UploadFile = File(...)) -> dict:
    cache = request.app.state.asset_cache
    get_client = request.app.state.get_client

    paths.asset_uploads_dir().mkdir(parents=True, exist_ok=True)
    suffix = Path(file.filename or "upload").suffix
    tmp_path = paths.asset_uploads_dir() / f"_incoming_{uuid.uuid4().hex}{suffix}"
    with tmp_path.open("wb") as out:
        shutil.copyfileobj(file.file, out)

    try:
        client = await get_client()
        try:
            entry = await cache.add(tmp_path, client)
        finally:
            await client.__aexit__(None, None, None)
    finally:
        try:
            tmp_path.unlink()
        except OSError:
            pass

    return entry.model_dump()


@router.get("/assets")
async def list_assets(request: Request) -> dict:
    cache = request.app.state.asset_cache
    return {"assets": [e.model_dump() for e in cache.list()]}


@router.delete("/assets/{sha256}", status_code=204)
async def delete_asset(sha256: str, request: Request):
    cache = request.app.state.asset_cache
    ok = await cache.delete(sha256)
    if not ok:
        raise HTTPException(404, detail={"error": "unknown_asset", "sha256": sha256})
    return Response(status_code=204)


@router.delete("/assets", status_code=204)
async def clear_assets(request: Request, all: bool = False):
    if not all:
        raise HTTPException(400, detail={"error": "missing_all_param"})
    cache = request.app.state.asset_cache
    await cache.clear()
    return Response(status_code=204)
