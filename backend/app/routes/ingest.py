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


def _note(steps: list[str], message: str) -> None:
    steps.append(message)
    print(f"[upload] {message}", flush=True)


def _fail(status: int, message: str, steps: list[str]) -> None:
    _note(steps, f"FAILED: {message}")
    raise HTTPException(status_code=status, detail={"message": message, "debug": steps})


@router.post("/upload", response_model=UploadResponse)
async def upload_file(
    file: UploadFile = File(...),
    name: str | None = Form(default=None),
    settings: Settings = Depends(get_settings),
) -> UploadResponse:
    """Each upload becomes its own document graph."""
    steps: list[str] = []
    _note(steps, f"collection={settings.qdrant_collection} model={settings.groq_model}")

    if not file.filename:
        _fail(400, "No file provided", steps)

    _note(steps, f"received {file.filename}")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ("csv", "pdf"):
        _fail(400, f"Unsupported file type (.{ext}). Only .csv and .pdf files are supported.", steps)

    try:
        contents = await file.read()
    except Exception as e:
        _fail(400, f"Failed to read file: {e}", steps)

    _note(steps, f"read {len(contents)} bytes")
    if len(contents) > MAX_FILE_SIZE:
        _fail(400, f"File exceeds maximum allowed size ({MAX_FILE_SIZE // (1024 * 1024)}MB).", steps)
    if len(contents) == 0:
        _fail(400, "Uploaded file is empty.", steps)

    try:
        nodes = await process_upload(file.filename, contents)
    except Exception as e:
        _fail(500, f"AI entity extraction failed: {e}", steps)

    _note(steps, f"extracted {len(nodes)} nodes")
    if not nodes:
        _fail(422, "No entities or relationships could be extracted from this file.", steps)

    graph_id = uuid4().hex[:12]
    display_name = (name or "").strip() or Path(file.filename).stem.replace("_", " ").replace("-", " ").strip()
    _note(steps, f"saving graph {graph_id} as {display_name or file.filename}")
    try:
        ingested = upsert_nodes(nodes, graph_id)
    except Exception as e:
        _fail(502, explain_store_error(e) or f"Saving the nodes failed: {e}", steps)

    _note(steps, f"wrote {ingested} nodes to Qdrant")
    try:
        edges = len(fetch_graph(len(nodes) + 10, [graph_id]).edges)
        graph = registry.create_graph(
            name=display_name or file.filename,
            filename=file.filename,
            node_count=ingested,
            edge_count=edges,
            graph_id=graph_id,
        )
    except Exception as e:
        graph = registry.get_graph(graph_id)
        if graph is None:
            delete_graph_nodes(graph_id)
            _fail(500, f"Saving the nodes failed: {e}", steps)
        _note(steps, f"nodes are in Qdrant, naming step failed: {e}")

    _note(steps, f"done: {graph['node_count']} nodes, {graph['edge_count']} links")
    return UploadResponse(
        graph=GraphInfo(**graph),
        extracted_nodes=len(nodes),
        ingested_nodes=ingested,
        collection=settings.qdrant_collection,
        debug=steps,
    )
