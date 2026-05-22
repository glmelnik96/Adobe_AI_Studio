"""Реестр доступных воркфлоу для sidecar.

Каждый workflow_class реализует Workflow (см. base.py) и имеет:
  WORKFLOW_SCHEMA_ID (int) — node_id в Phygital
  NODE_NAME (str)          — человекочитаемое имя

NODES — единый источник для GET /nodes и для POST /jobs (валидация node_id).
"""
from __future__ import annotations

from app.workflows.base import Workflow
from app.workflows.image_gen import ImageGenWorkflow
from app.workflows.video_kling import KlingWorkflow
from app.workflows.video_kling_motion import KlingMotionWorkflow
from app.workflows.video_kling_omni import KlingOmniWorkflow
from app.workflows.video_seedance import SeedanceWorkflow

NODES: dict[int, type[Workflow]] = {
    94: ImageGenWorkflow,        # Nano Banana (Gemini Image API)
    74: KlingWorkflow,           # Kling v3 pro
    100: SeedanceWorkflow,       # Seedance 2.0 p720
    121: KlingOmniWorkflow,      # Kling Omni 3 pro
    124: KlingMotionWorkflow,    # Kling Motion v3 pro
}

NODE_NAMES: dict[int, str] = {
    94: "Nano Banana",
    74: "Kling v3 pro",
    100: "Seedance 2.0 p720",
    121: "Kling Omni 3 pro",
    124: "Kling Motion v3 pro",
}
