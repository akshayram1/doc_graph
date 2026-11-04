from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends

from app.config import Settings, get_settings

router = APIRouter(tags=["system"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/api/status")
def status(settings: Settings = Depends(get_settings)) -> dict[str, Any]:
    return {
        "app": settings.app_name,
        "environment": settings.environment,
        "status": "running",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "collection": settings.qdrant_collection,
        "qdrantConfigured": bool(settings.qdrant_url),
        "chatConfigured": bool(settings.groq_api_key),
    }
