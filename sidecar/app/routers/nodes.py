"""GET /nodes, GET /nodes/video — список доступных нод и видео-матрица."""
from __future__ import annotations

from fastapi import APIRouter

from app.workflows import NODES, NODE_NAMES
from app.workflows.video_common import describe_video_nodes

router = APIRouter()


@router.get("/nodes")
async def list_nodes() -> dict:
    nodes = []
    for node_id, workflow_class in NODES.items():
        nodes.append({
            "id": node_id,
            "name": NODE_NAMES.get(node_id, str(node_id)),
            "workflow_class": workflow_class.__name__,
        })
    return {"nodes": nodes}


@router.get("/nodes/video")
async def list_video_nodes() -> dict:
    """Матрица видео-нод: модель, слоты, сценарии, default params.

    Фронт использует эту матрицу чтобы построить UI выбора модели/сценария.
    """
    return {"nodes": describe_video_nodes()}
