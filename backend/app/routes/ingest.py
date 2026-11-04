from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from app.config import Settings, get_settings
from app.schemas import GraphInfo, UploadResponse
from app.services import registry
from app.services.ingest import process_upload
from app.services.store import delete_graph_nodes, explain_store_error, fetch_graph, upsert_nodes

router = APIRouter(prefix="/api", tags=["ingest"])

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    settings: Settings = Depends(get_settings),
) -> UploadResponse:
    """Each upload becomes its own document graph."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("csv", "pdf"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type (.{ext}). Only .csv and .pdf files are supported.",
        )

    try:
        contents = await file.read()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    if len(contents) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail=f"File exceeds maximum allowed size ({MAX_FILE_SIZE // (1024 * 1024)}MB).",
        )

    if len(contents) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")

    try:
        nodes = await process_upload(file.filename, contents)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI entity extraction failed: {e}")

    if not nodes:
        raise HTTPException(
            status_code=422,
            detail="No entities or relationships could be extracted from this file. Ensure the file contains readable text.",
        )

    graph_id = uuid4().hex[:12]
    display_name = (name or "").strip() or Path(file.filename).stem.replace("_", " ").replace("-", " ").strip()
    try:
        ingested = upsert_nodes(nodes, graph_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=explain_store_error(e) or f"Saving the nodes failed: {e}")

    try:
        edges = len(fetch_graph(len(nodes) + 10, [graph_id]).edges)
        graph = registry.create_graph(
            name=display_name or file.filename,
            filename=file.filename,
            node_count=ingested,
            edge_count=edges,
            graph_id=graph_id,
        )
    except Exception:
        # Nodes are already in Qdrant. A naming failure must not delete them.
        graph = registry.get_graph(graph_id)
        if graph is None:
            delete_graph_nodes(graph_id)
            raise HTTPException(status_code=500, detail="Saving the nodes failed.")

    return UploadResponse(
        graph=GraphInfo(**graph),
        extracted_nodes=len(nodes),
        ingested_nodes=ingested,
        collection=settings.qdrant_collection,
    )
