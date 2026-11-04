from fastapi import APIRouter, Depends

from app.config import Settings, get_settings
from app.schemas import SearchRequest, SearchResponse
from app.services.store import search_nodes

router = APIRouter(prefix="/api", tags=["search"])


@router.post("/search", response_model=SearchResponse)
def search(
    request: SearchRequest,
    settings: Settings = Depends(get_settings),
) -> SearchResponse:
    limit = request.limit or settings.retrieval_limit
    return SearchResponse(query=request.query, hits=search_nodes(request.query, limit, request.graph_ids))
