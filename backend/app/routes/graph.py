from fastapi import APIRouter, Depends, HTTPException, Query

from app.config import Settings, get_settings
from app.schemas import ClearResponse, GraphDeleteResponse, GraphInfo, GraphResponse
from app.services import registry
from app.services.store import clear_collection, delete_graph_nodes, ensure_collection, explain_store_error, fetch_graph

router = APIRouter(prefix="/api", tags=["graph"])


def parse_ids(graph_ids: str | None) -> list[str] | None:
    """`?graph_ids=a,b` → ['a', 'b']; missing → None (every graph); empty → []."""
    if graph_ids is None:
        return None
    return [gid for gid in (part.strip() for part in graph_ids.split(",")) if gid]


@router.get("/graphs", response_model=list[GraphInfo])
def list_graphs() -> list[GraphInfo]:
    try:
        ensure_collection()
        return [GraphInfo(**graph) for graph in registry.list_graphs()]
    except Exception as exc:
        hint = explain_store_error(exc)
        if hint:
            raise HTTPException(status_code=502, detail=hint) from exc
        raise


@router.delete("/graphs/{graph_id}", response_model=GraphDeleteResponse)
def delete_graph(graph_id: str) -> GraphDeleteResponse:
    if registry.get_graph(graph_id) is None:
        raise HTTPException(status_code=404, detail="Graph not found")
    deleted = delete_graph_nodes(graph_id)
    registry.delete_graph(graph_id)
    return GraphDeleteResponse(id=graph_id, deleted_nodes=deleted)


@router.get("/graph", response_model=GraphResponse)
def graph(
    limit: int | None = None,
    graph_ids: str | None = Query(default=None, description="Comma-separated graph ids"),
    settings: Settings = Depends(get_settings),
) -> GraphResponse:
    return fetch_graph(limit or settings.graph_node_limit, parse_ids(graph_ids))


@router.delete("/graph", response_model=ClearResponse)
def delete_everything(settings: Settings = Depends(get_settings)) -> ClearResponse:
    deleted = clear_collection()
    return ClearResponse(deleted=deleted, collection=settings.qdrant_collection)
