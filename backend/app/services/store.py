import re
from collections.abc import Sequence
from functools import lru_cache
from uuid import NAMESPACE_URL, uuid5

from qdrant_client import QdrantClient, models

from app.config import get_settings
from app.schemas import GraphEdge, GraphNode, GraphResponse, NodeInput, SearchHit
from app.services import registry
from app.services.embeddings import encode_documents, encode_query

SPARSE_VECTOR_NAME = "bm25"
GRAPH_FIELD = "graph_id"
DOC_NAME = "doc_name"
DOC_FILE = "filename"
DOC_COLOR = "color"
DOC_CREATED = "doc_created_at"
DOC_FIELDS = (DOC_NAME, DOC_FILE, DOC_COLOR, DOC_CREATED)
SCROLL_PAGE = 256


class StoreNotConfigured(RuntimeError):
    pass


def explain_store_error(exc: Exception) -> str | None:
    """Qdrant says Not Found when this machine's .env does not point at the real collection."""
    text = str(exc)
    if "not found" in text.lower() or "404" in text:
        return (
            "Qdrant returned Not Found, so no nodes were saved. "
            "Copy the real .env onto this computer (QDRANT_URL, QDRANT_API_KEY, QDRANT_COLLECTION). "
            "The example file does not point at the collection that already has the documents."
        )
    return None


@lru_cache
def get_client() -> QdrantClient:
    settings = get_settings()

    if not settings.qdrant_url:
        raise StoreNotConfigured("QDRANT_URL is not set")

    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key or None,
        prefer_grpc=False,
    )


def node_uid(graph_id: str, key: str) -> str:
    """Node id that stays unique when several graphs are shown together."""
    return f"{graph_id}:{key}"


def point_id(graph_id: str, key: str) -> str:
    return str(uuid5(NAMESPACE_URL, node_uid(graph_id, key)))


def graph_filter(graph_ids: Sequence[str] | None) -> models.Filter | None:
    if graph_ids is None:
        return None
    return models.Filter(
        must=[models.FieldCondition(key=GRAPH_FIELD, match=models.MatchAny(any=list(graph_ids)))]
    )


def ensure_collection() -> str:
    """Create the collection and graph_id index if missing.

    Checked on every call (one cheap request) rather than cached, so the app
    recovers if the collection is dropped or recreated by another client.
    """
    settings = get_settings()
    client = get_client()
    collection = settings.qdrant_collection

    if not client.collection_exists(collection_name=collection):
        client.create_collection(
            collection_name=collection,
            vectors_config={},
            sparse_vectors_config={
                SPARSE_VECTOR_NAME: models.SparseVectorParams(
                    modifier=models.Modifier.IDF,
                )
            },
        )

    schema = client.get_collection(collection_name=collection).payload_schema or {}
    if GRAPH_FIELD not in schema:
        client.create_payload_index(
            collection_name=collection,
            field_name=GRAPH_FIELD,
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
        # A fresh index usually means a fresh or foreign-written collection.
        _migrate_untagged(client, collection)

    return collection


_adopting = False


def _adopt_untagged(client: QdrantClient, collection: str, records: list) -> None:
    """Points already in Qdrant with no document id still belong on the document list.

    Uploads from before each file became its own graph have nodes, but no graph_id,
    so the list skipped them. They are grouped into one document and named in Qdrant.
    """
    global _adopting
    if _adopting:
        return
    missing = [record for record in records if not (record.payload or {}).get(GRAPH_FIELD)]
    if not missing:
        return

    from datetime import datetime, timezone

    _adopting = True
    try:
        graph_id = registry.LEGACY_GRAPH_ID
        created_at = datetime.now(timezone.utc).isoformat()
        client.set_payload(
            collection_name=collection,
            payload={GRAPH_FIELD: graph_id},
            points=[record.id for record in missing],
            wait=True,
        )
        sample = next(
            (
                record.payload or {}
                for record in records
                if (record.payload or {}).get(GRAPH_FIELD) == graph_id and (record.payload or {}).get(DOC_NAME)
            ),
            {},
        )
        name = sample.get(DOC_NAME) or "Earlier uploads"
        filename = sample.get(DOC_FILE) or "(uploaded before documents were tracked)"
        color = sample.get(DOC_COLOR) or registry.color_for(graph_id)
        created_at = sample.get(DOC_CREATED) or created_at
        stamp_document(graph_id, name, filename, color, created_at)
    finally:
        _adopting = False

    for record in missing:
        payload = record.payload or {}
        payload[GRAPH_FIELD] = graph_id
        payload[DOC_NAME] = name
        payload[DOC_FILE] = filename
        payload[DOC_COLOR] = color
        payload[DOC_CREATED] = created_at
        record.payload = payload


def _migrate_untagged(client: QdrantClient, collection: str) -> None:
    """Used when the collection is first indexed. Listing adopts the same points."""
    untagged = models.Filter(
        must=[models.IsEmptyCondition(is_empty=models.PayloadField(key=GRAPH_FIELD))]
    )
    count = client.count(collection_name=collection, count_filter=untagged, exact=True).count
    if count == 0:
        return
    _adopt_untagged(client, collection, _scroll(client, collection, None, 100_000))


def _document_meta(client: QdrantClient, collection: str, graph_id: str) -> dict:
    """Name, file, colour, and time already stored on this document's nodes."""
    existing = _scroll(client, collection, [graph_id], 1)
    if not existing:
        return {}
    payload = existing[0].payload or {}
    return {field: payload[field] for field in DOC_FIELDS if payload.get(field)}


def stamp_document(graph_id: str, name: str, filename: str, color: str, created_at: str) -> None:
    """Write document metadata onto every node of a graph. This is what other machines read."""
    collection = ensure_collection()
    client = get_client()
    client.set_payload(
        collection_name=collection,
        payload={
            DOC_NAME: name,
            DOC_FILE: filename,
            DOC_COLOR: color,
            DOC_CREATED: created_at,
        },
        points=graph_filter([graph_id]),
        wait=True,
    )


def document_graphs() -> list[dict]:
    """One card per document actually stored in Qdrant, including older uploads."""
    collection = ensure_collection()
    client = get_client()
    records = _scroll(client, collection, None, 100_000)
    _adopt_untagged(client, collection, records)
    groups: dict[str, dict] = {}

    for record in records:
        payload = record.payload or {}
        graph_id = payload.get(GRAPH_FIELD) or ""
        key = payload.get("key")
        if not graph_id or not key:
            continue
        group = groups.get(graph_id)
        if group is None:
            group = {
                "id": graph_id,
                "name": "",
                "filename": "",
                "color": "",
                "created_at": "",
                "keys": set(),
                "relations": [],
            }
            groups[graph_id] = group
        group["keys"].add(key)
        group["relations"].append((key, payload.get("relations") or []))
        if not group["name"] and payload.get(DOC_NAME):
            group["name"] = payload[DOC_NAME]
        if not group["filename"] and payload.get(DOC_FILE):
            group["filename"] = payload[DOC_FILE]
        if not group["color"] and payload.get(DOC_COLOR):
            group["color"] = payload[DOC_COLOR]
        if not group["created_at"] and payload.get(DOC_CREATED):
            group["created_at"] = payload[DOC_CREATED]

    graphs = []
    for group in groups.values():
        seen: set[tuple[str, str, str]] = set()
        edges = 0
        for key, relations in group["relations"]:
            for relation in relations:
                target = relation.get("target", "")
                rel_type = relation.get("type", "related_to")
                signature = (key, target, rel_type)
                if target in group["keys"] and target != key and signature not in seen:
                    seen.add(signature)
                    edges += 1
        graphs.append(
            {
                "id": group["id"],
                "name": group["name"] or group["id"],
                "filename": group["filename"] or "",
                "color": group["color"],
                "node_count": len(group["keys"]),
                "edge_count": edges,
                "created_at": group["created_at"],
            }
        )
    graphs.sort(key=lambda graph: graph["created_at"], reverse=True)
    return graphs


def upsert_nodes(nodes: Sequence[NodeInput], graph_id: str) -> int:
    collection = ensure_collection()
    client = get_client()
    vectors = encode_documents([f"{node.label}. {node.text}" for node in nodes])
    meta = _document_meta(client, collection, graph_id)

    points = [
        models.PointStruct(
            id=point_id(graph_id, node.key),
            vector={SPARSE_VECTOR_NAME: vector},
            payload={
                GRAPH_FIELD: graph_id,
                "key": node.key,
                "label": node.label,
                "text": node.text,
                "type": node.type,
                "relations": [relation.model_dump() for relation in node.relations],
                **meta,
            },
        )
        for node, vector in zip(nodes, vectors, strict=True)
    ]

    client.upsert(collection_name=collection, points=points, wait=True)
    return len(points)


def _hit(point) -> SearchHit:
    payload = point.payload or {}
    graph_id = payload.get(GRAPH_FIELD, "")
    key = payload.get("key", str(point.id))
    return SearchHit(
        uid=node_uid(graph_id, key),
        key=key,
        graph_id=graph_id,
        label=payload.get("label", ""),
        type=payload.get("type", "concept"),
        text=payload.get("text", ""),
        score=point.score,
    )


def search_nodes(query: str, limit: int, graph_ids: Sequence[str] | None = None) -> list[SearchHit]:
    collection = ensure_collection()
    client = get_client()
    vector = encode_query(query)

    def run(ids: Sequence[str] | None, n: int) -> list[SearchHit]:
        response = client.query_points(
            collection_name=collection,
            query=vector,
            using=SPARSE_VECTOR_NAME,
            query_filter=graph_filter(ids),
            limit=n,
            with_payload=True,
        )
        return [_hit(point) for point in response.points]

    if graph_ids is not None and len(graph_ids) == 0:
        return []

    if graph_ids is None or len(graph_ids) == 1:
        return run(graph_ids, limit)

    # Several graphs: BM25 scores from a large document would crowd out a small one,
    # so take the best hits from each graph, then rank the union.
    per_graph = max(2, -(-limit // len(graph_ids)) + 1)
    merged: list[SearchHit] = []
    for graph_id in graph_ids:
        merged.extend(run([graph_id], per_graph))
    merged.sort(key=lambda hit: hit.score, reverse=True)
    return merged[: limit + len(graph_ids)]


def _scroll(client: QdrantClient, collection: str, graph_ids: Sequence[str] | None, limit: int) -> list:
    records: list = []
    offset = None
    while len(records) < limit:
        page, offset = client.scroll(
            collection_name=collection,
            scroll_filter=graph_filter(graph_ids),
            limit=min(SCROLL_PAGE, limit - len(records)),
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        records.extend(page)
        if offset is None:
            break
    return records


def _norm(label: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", label.lower()).strip()


def _build_graph(records: list) -> GraphResponse:
    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    payloads: list[dict] = []

    for record in records:
        payload = record.payload or {}
        key = payload.get("key")
        if not key:
            continue
        graph_id = payload.get(GRAPH_FIELD, "")
        nodes.append(
            GraphNode(
                uid=node_uid(graph_id, key),
                key=key,
                graph_id=graph_id,
                label=payload.get("label", key),
                type=payload.get("type", "concept"),
                text=payload.get("text", ""),
            )
        )
        payloads.append(payload)

    known = {node.uid for node in nodes}
    seen: set[tuple[str, str, str]] = set()

    for payload in payloads:
        graph_id = payload.get(GRAPH_FIELD, "")
        source = node_uid(graph_id, payload["key"])
        for relation in payload.get("relations", []):
            target = node_uid(graph_id, relation.get("target", ""))
            rel_type = relation.get("type", "related_to")
            signature = (source, target, rel_type)
            if target in known and target != source and signature not in seen:
                seen.add(signature)
                edges.append(GraphEdge(source=source, target=target, type=rel_type))

    # When several documents are open, link the entities they share.
    by_identity: dict[str, list[GraphNode]] = {}
    for node in nodes:
        by_identity.setdefault(f"key::{node.key}", []).append(node)
        label = _norm(node.label)
        if label:
            by_identity.setdefault(f"label::{label}", []).append(node)

    bridged: set[tuple[str, str]] = set()
    for group in by_identity.values():
        for i, a in enumerate(group):
            for b in group[i + 1 :]:
                if a.graph_id == b.graph_id:
                    continue
                pair = tuple(sorted((a.uid, b.uid)))
                if pair in bridged:
                    continue
                bridged.add(pair)
                edges.append(GraphEdge(source=pair[0], target=pair[1], type="same_entity", cross=True))

    return GraphResponse(nodes=nodes, edges=edges)


def fetch_graph(limit: int, graph_ids: Sequence[str] | None = None) -> GraphResponse:
    collection = ensure_collection()
    client = get_client()

    if graph_ids is not None and len(graph_ids) == 0:
        return GraphResponse(nodes=[], edges=[])

    if graph_ids is None:
        return _build_graph(_scroll(client, collection, None, limit))

    # The node limit applies per document so one big file doesn't hide the others.
    records: list = []
    for graph_id in graph_ids:
        records.extend(_scroll(client, collection, [graph_id], limit))
    return _build_graph(records)


def delete_graph_nodes(graph_id: str) -> int:
    collection = ensure_collection()
    client = get_client()
    flt = graph_filter([graph_id])
    count = client.count(collection_name=collection, count_filter=flt, exact=True).count
    client.delete(collection_name=collection, points_selector=models.FilterSelector(filter=flt), wait=True)
    return count


def clear_collection() -> int:
    client = get_client()
    collection = ensure_collection()
    count = 0
    try:
        count = client.get_collection(collection).points_count or 0
    except Exception:
        pass

    try:
        client.delete_collection(collection)
    except Exception:
        pass

    ensure_collection()
    registry.clear_graphs()
    return count
