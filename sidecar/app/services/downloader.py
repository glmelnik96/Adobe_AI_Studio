"""Скачиватель URL'ов в локальный каталог.

S3 от Phygital периодически даёт 5xx — поэтому ретраим с backoff.
"""
from __future__ import annotations

import asyncio
import ssl
from pathlib import Path
from urllib.parse import urlparse

import httpx
import truststore
from loguru import logger


_SSL_CTX = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)


class DownloadError(Exception):
    pass


# Расширения по content-type, как fallback если URL без явного suffix.
_EXT_BY_TYPE = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
    "application/octet-stream": ".bin",
}


def _ext_from_url(url: str) -> str | None:
    path = urlparse(url).path
    if "." in path.rsplit("/", 1)[-1]:
        return Path(path).suffix
    return None


def _ext_from_content_type(ct: str | None) -> str:
    if not ct:
        return ".bin"
    base = ct.split(";", 1)[0].strip().lower()
    return _EXT_BY_TYPE.get(base, ".bin")


async def download_urls(
    *,
    urls: list[str],
    out_dir: Path,
    transport: httpx.AsyncBaseTransport | None = None,
    timeout: float = 300.0,
    retries: int = 3,
    retry_delay: float = 1.0,
    max_concurrency: int = 4,
) -> list[Path]:
    """Качает все URL в out_dir. Имена файлов — 0001.<ext>, 0002.<ext>, ...

    URL'ы качаются параллельно (Semaphore(max_concurrency)), порядок
    результатов соответствует порядку urls.

    Returns: список путей сохранённых файлов.
    Raises: DownloadError если хотя бы один URL не скачался после retries.
    """
    out_dir.mkdir(parents=True, exist_ok=True)

    kwargs: dict = {"timeout": timeout, "verify": _SSL_CTX, "follow_redirects": True}
    if transport is not None:
        kwargs["transport"] = transport
        kwargs.pop("verify")  # MockTransport не использует verify

    sem = asyncio.Semaphore(max(1, max_concurrency))

    async def _download_one(client: httpx.AsyncClient, idx: int, url: str) -> Path:
        async with sem:
            for attempt in range(1, retries + 1):
                try:
                    # Стримим в файл вместо resp.content — видео-файлы от
                    # Phygital'а могут быть 50-300 MB; держать их в RAM
                    # параллельно с n_concurrent jobs = OOM. Stream пишет
                    # по 64 KiB chunk'ам.
                    async with client.stream("GET", url) as resp:
                        if 500 <= resp.status_code < 600:
                            raise httpx.HTTPStatusError(
                                f"{resp.status_code} from {url}",
                                request=resp.request, response=resp,
                            )
                        resp.raise_for_status()
                        ext = _ext_from_url(url) or _ext_from_content_type(
                            resp.headers.get("Content-Type"),
                        )
                        name = f"{idx:04d}{ext}"
                        fpath = out_dir / name
                        # Атомарно: пишем в .part и переименовываем, чтобы
                        # прерванный download не оставил половинный файл,
                        # который JobRunner потом отдаст по /download.
                        tmp_path = fpath.with_suffix(fpath.suffix + ".part")
                        try:
                            with tmp_path.open("wb") as out:
                                async for chunk in resp.aiter_bytes(chunk_size=65536):
                                    out.write(chunk)
                            tmp_path.replace(fpath)
                        except BaseException:
                            try:
                                tmp_path.unlink(missing_ok=True)
                            except OSError:
                                pass
                            raise
                    return fpath
                except (httpx.HTTPStatusError, httpx.RequestError) as e:
                    if attempt >= retries:
                        raise DownloadError(f"Failed to download {url} after {retries} attempts: {e}") from e
                    delay = retry_delay * (2 ** (attempt - 1))
                    logger.warning(f"download {url}: attempt {attempt}/{retries} failed ({e}); sleep {delay:.1f}s")
                    await asyncio.sleep(delay)
            raise DownloadError(f"Failed to download {url}")  # unreachable

    async with httpx.AsyncClient(**kwargs) as client:
        # return_exceptions=True — даём всем задачам завершиться до выхода из
        # client-контекста, затем поднимаем первую ошибку (семантика как у
        # последовательной версии: одна неудача = DownloadError всего батча).
        gathered = await asyncio.gather(
            *(_download_one(client, idx, url) for idx, url in enumerate(urls, start=1)),
            return_exceptions=True,
        )
    for item in gathered:
        if isinstance(item, BaseException):
            raise item
    return list(gathered)  # type: ignore[arg-type]
