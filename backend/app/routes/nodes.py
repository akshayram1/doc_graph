from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.schemas import IngestRequest, IngestResponse
from app.services import registry
from app.services.store import upsert_nodes

router = APIRouter(prefix="/api", tags=["nodes"])


@router.post("/nodes", response_model=IngestResponse)
def ingest_nodes(
    request: IngestRequest,
    settings: Settings = Depends(get_settings),
) -> IngestResponse:
    ingested = upsert_nodes(request.nodes, request.graph_id)
    if registry.get_graph(request.graph_id) is None:
        registry.create_graph(
            name=request.graph_id,
            filename="(posted via /api/nodes)",
            node_count=ingested,
            edge_count=sum(len(node.relations) for node in request.nodes),
            graph_id=request.graph_id,
        )
    return IngestResponse(ingested=ingested, collection=settings.qdrant_collection)
