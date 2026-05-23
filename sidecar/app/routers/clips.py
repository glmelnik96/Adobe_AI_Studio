"""POST /clip-video — рендер фрагмента видео по in/out секундам через ffmpeg.

Используется CEP-панелью, когда пользователь выбрал клип в Source Monitor и
выставил In/Out — вместо загрузки всего исходника на Phygital+ мы локально
вырезаем нужный фрагмент и панель уже загружает короткий клип.

ffmpeg должен быть в PATH (см. cep-premiere/README.md → Prerequisites). Если
он не найден — возвращаем `ffmpeg_missing` с подсказкой.
"""
from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import paths

router = APIRouter()


class ClipVideoRequest(BaseModel):
    source_path: str
    in_sec: float
    out_sec: float


class ExtractFrameRequest(BaseModel):
    source_path: str
    at_sec: float


@router.post("/clip-video")
async def clip_video(req: ClipVideoRequest) -> dict:
    src = Path(req.source_path)
    if not src.exists():
        raise HTTPException(400, detail={"error": "source_not_found", "path": str(src)})
    if req.out_sec <= req.in_sec:
        raise HTTPException(400, detail={"error": "invalid_range",
                                         "in_sec": req.in_sec, "out_sec": req.out_sec})

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(500, detail={
            "error": "ffmpeg_missing",
            "hint": "Install ffmpeg and ensure it is on PATH (see cep-premiere/README.md).",
        })

    paths.asset_uploads_dir().mkdir(parents=True, exist_ok=True)
    suffix = src.suffix or ".mp4"
    out_path = paths.asset_uploads_dir() / f"clip_{uuid.uuid4().hex}{suffix}"

    duration = max(0.04, float(req.out_sec) - float(req.in_sec))
    # Re-encode (не -c copy): stream copy ломается на не-keyframe границах и
    # часто даёт пустой первый GOP. libx264+aac короткий клип кодирует быстро.
    cmd = [
        ffmpeg, "-y",
        "-ss", f"{float(req.in_sec):.3f}",
        "-i", str(src),
        "-t", f"{duration:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(500, detail={
            "error": "ffmpeg_failed",
            "code": proc.returncode,
            "stderr": stderr.decode(errors="replace")[-2000:],
        })

    return {
        "path": str(out_path),
        "in_sec": req.in_sec,
        "out_sec": req.out_sec,
        "duration_sec": duration,
        "size_bytes": out_path.stat().st_size,
    }


@router.post("/extract-frame")
async def extract_frame(req: ExtractFrameRequest) -> dict:
    """Извлечь один кадр из source-файла в указанный source-relative момент.

    Используется CEP-панелью для Timeline frame: QE DOM frame export сломан на
    части билдов Pr (на user-машине qe.exportFrameJPEG/PNG/TIFF/Targa/DPX молча
    возвращают rv=false без exception и без файла). Поэтому host.jsx находит
    топовый видео-клип под playhead'ом, пересчитывает source-relative секунду
    и зовёт этот endpoint — ffmpeg извлекает кадр напрямую из исходника, минуя
    Pr-рендер.
    """
    src = Path(req.source_path)
    if not src.exists():
        raise HTTPException(400, detail={"error": "source_not_found", "path": str(src)})
    if req.at_sec < 0:
        raise HTTPException(400, detail={"error": "invalid_time", "at_sec": req.at_sec})

    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise HTTPException(500, detail={
            "error": "ffmpeg_missing",
            "hint": "Install ffmpeg and ensure it is on PATH (see cep-premiere/README.md).",
        })

    paths.asset_uploads_dir().mkdir(parents=True, exist_ok=True)
    out_path = paths.asset_uploads_dir() / f"frame_{uuid.uuid4().hex}.jpg"

    # -ss ПЕРЕД -i = fast seek по keyframes, потом точная декодировка одного
    # кадра. -frames:v 1 = ровно один кадр. -q:v 2 = JPEG visually-lossless.
    cmd = [
        ffmpeg, "-y",
        "-ss", f"{float(req.at_sec):.3f}",
        "-i", str(src),
        "-frames:v", "1",
        "-q:v", "2",
        str(out_path),
    ]
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    _stdout, stderr = await proc.communicate()
    if proc.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
        try:
            out_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(500, detail={
            "error": "ffmpeg_failed",
            "code": proc.returncode,
            "stderr": stderr.decode(errors="replace")[-2000:],
        })

    return {
        "path": str(out_path),
        "at_sec": req.at_sec,
        "size_bytes": out_path.stat().st_size,
    }
