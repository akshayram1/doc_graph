from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routes.chat import router as chat_router
from app.routes.graph import router as graph_router
from app.routes.health import router as health_router
from app.routes.ingest import router as ingest_router
from app.routes.nodes import router as nodes_router
from app.routes.search import router as search_router
from app.services.chat import ChatNotConfigured
from app.services.store import StoreNotConfigured

settings = get_settings()

app = FastAPI(title=f"{settings.app_name} API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(nodes_router)
app.include_router(search_router)
app.include_router(graph_router)
app.include_router(chat_router)
app.include_router(ingest_router)


@app.exception_handler(StoreNotConfigured)
async def handle_store_not_configured(request: Request, exc: StoreNotConfigured) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": f"Qdrant is not configured: {exc}"},
    )


@app.exception_handler(ChatNotConfigured)
async def handle_chat_not_configured(request: Request, exc: ChatNotConfigured) -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"detail": f"Groq is not configured: {exc}"},
    )
