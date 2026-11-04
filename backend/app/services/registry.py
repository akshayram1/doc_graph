"""Document graphs and chats, stored in Qdrant.

Nodes live in the main collection. Each node carries the document name, file,
colour, and created time, so any machine with the same Qdrant credentials sees
the same document list. Chats live in a companion collection
(`<collection>__workspace`) because they are not graph nodes.

A leftover `backend/data/workspace.json` from the old local store is copied
into Qdrant once, then renamed. After that the file is not read.
"""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from qdrant_client import models

DATA_DIR = Path(__file__).resolve().parents[2] / "data"
STORE_PATH = DATA_DIR / "workspace.json"

GRAPH_COLORS = [
    "#4f6df5",
    "#0f9d8f",
    "#e8590c",
    "#c2255c",
    "#7048e8",
    "#2b8a3e",
    "#1971c2",
    "#b8860b",
]

LEGACY_GRAPH_ID = "earlier-uploads"

_lock = threading.RLock()
_imported = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def color_for(graph_id: str) -> str:
    return GRAPH_COLORS[uuid5(NAMESPACE_URL, graph_id).int % len(GRAPH_COLORS)]


def _client():
    from app.services.store import get_client

    return get_client()


def _workspace_name() -> str:
    from app.config import get_settings

    return f"{get_settings().qdrant_collection}__workspace"


def _ensure_workspace() -> str:
    client = _client()
    name = _workspace_name()
    if not client.collection_exists(collection_name=name):
        client.create_collection(
            collection_name=name,
            vectors_config=models.VectorParams(size=1, distance=models.Distance.COSINE),
        )
    schema = client.get_collection(collection_name=name).payload_schema or {}
    if "kind" not in schema:
        client.create_payload_index(
            collection_name=name,
            field_name="kind",
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
    return name


def _chat_point_id(chat_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"finsk-chat:{chat_id}"))


def _import_local_file() -> None:
    """Copy the old on-disk workspace into Qdrant a single time."""
    global _imported
    if _imported or not STORE_PATH.exists():
        _imported = True
        return

    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _imported = True
        return

    from app.services.store import document_graphs, stamp_document

    present = {graph["id"] for graph in document_graphs()}
    for graph in data.get("graphs", []):
        graph_id = graph.get("id")
        if graph_id not in present:
            continue
        stamp_document(
            graph_id,
            graph.get("name") or graph_id,
            graph.get("filename") or "",
            graph.get("color") or color_for(graph_id),
            graph.get("created_at") or _now(),
        )

    known = {graph["id"] for graph in document_graphs()}
    for chat in data.get("chats", []):
        if not chat.get("id") or _get_chat(chat["id"]) is not None:
            continue
        chat["graph_ids"] = [gid for gid in chat.get("graph_ids", []) if gid in known]
        chat.setdefault("messages", [])
        chat.setdefault("title", "New chat")
        chat.setdefault("created_at", _now())
        chat.setdefault("updated_at", chat["created_at"])
        _upsert_chat(chat)

    migrated = STORE_PATH.with_name("workspace.json.migrated")
    STORE_PATH.replace(migrated)
    _imported = True


# ---------------------------------------------------------------- graphs


def list_graphs() -> list[dict[str, Any]]:
    with _lock:
        _import_local_file()
        from app.services.store import document_graphs

        graphs = document_graphs()
        for graph in graphs:
            if not graph["color"]:
                graph["color"] = color_for(graph["id"])
        return graphs


def get_graph(graph_id: str) -> dict[str, Any] | None:
    return next((graph for graph in list_graphs() if graph["id"] == graph_id), None)


def create_graph(
    name: str,
    filename: str,
    node_count: int,
    edge_count: int,
    graph_id: str | None = None,
) -> dict[str, Any]:
    with _lock:
        _import_local_file()
        from app.services.store import stamp_document

        gid = graph_id or uuid4().hex[:12]
        created_at = _now()
        color = color_for(gid)
        stamp_document(gid, name, filename, color, created_at)
        stored = get_graph(gid)
        if stored is not None:
            return stored
        return {
            "id": gid,
            "name": name,
            "filename": filename,
            "color": color,
            "node_count": node_count,
            "edge_count": edge_count,
            "created_at": created_at,
        }


def delete_graph(graph_id: str) -> bool:
    """Drop the document from every chat. Nodes are removed by the caller."""
    with _lock:
        _import_local_file()
        changed = False
        for chat in _all_chats():
            if graph_id not in chat.get("graph_ids", []):
                continue
            chat["graph_ids"] = [gid for gid in chat["graph_ids"] if gid != graph_id]
            chat["updated_at"] = _now()
            _upsert_chat(chat)
            changed = True
        return changed


def clear_graphs() -> None:
    with _lock:
        _import_local_file()
        for chat in _all_chats():
            if not chat.get("graph_ids"):
                continue
            chat["graph_ids"] = []
            chat["updated_at"] = _now()
            _upsert_chat(chat)


# ---------------------------------------------------------------- chats


def _summary(chat: dict[str, Any]) -> dict[str, Any]:
    messages = chat.get("messages", [])
    last = messages[-1]["content"] if messages else ""
    return {
        "id": chat["id"],
        "title": chat["title"],
        "graph_ids": chat["graph_ids"],
        "created_at": chat["created_at"],
        "updated_at": chat["updated_at"],
        "message_count": len(messages),
        "last_message": last[:160],
    }


def _upsert_chat(chat: dict[str, Any]) -> None:
    name = _ensure_workspace()
    payload = {"kind": "chat", **chat}
    _client().upsert(
        collection_name=name,
        points=[
            models.PointStruct(
                id=_chat_point_id(chat["id"]),
                vector=[1.0],
                payload=payload,
            )
        ],
        wait=True,
    )


def _all_chats() -> list[dict[str, Any]]:
    name = _ensure_workspace()
    client = _client()
    records: list = []
    offset = None
    chat_filter = models.Filter(
        must=[models.FieldCondition(key="kind", match=models.MatchValue(value="chat"))]
    )
    while True:
        page, offset = client.scroll(
            collection_name=name,
            scroll_filter=chat_filter,
            limit=64,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        records.extend(page)
        if offset is None:
            break
    chats = []
    for record in records:
        payload = dict(record.payload or {})
        payload.pop("kind", None)
        if payload.get("id"):
            chats.append(payload)
    return chats


def _get_chat(chat_id: str) -> dict[str, Any] | None:
    name = _ensure_workspace()
    found = _client().retrieve(
        collection_name=name,
        ids=[_chat_point_id(chat_id)],
        with_payload=True,
        with_vectors=False,
    )
    if not found:
        return None
    payload = dict(found[0].payload or {})
    if payload.get("kind") != "chat":
        return None
    payload.pop("kind", None)
    return payload


def list_chats() -> list[dict[str, Any]]:
    with _lock:
        _import_local_file()
        chats = sorted(_all_chats(), key=lambda chat: chat.get("updated_at", ""), reverse=True)
        return [_summary(chat) for chat in chats]


def get_chat(chat_id: str) -> dict[str, Any] | None:
    with _lock:
        _import_local_file()
        return _get_chat(chat_id)


def create_chat(title: str | None, graph_ids: list[str]) -> dict[str, Any]:
    with _lock:
        _import_local_file()
        known = {graph["id"] for graph in list_graphs()}
        now = _now()
        chat = {
            "id": uuid4().hex[:12],
            "title": (title or "").strip() or "New chat",
            "graph_ids": [gid for gid in graph_ids if gid in known],
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }
        _upsert_chat(chat)
        return chat


def update_chat(
    chat_id: str,
    title: str | None = None,
    graph_ids: list[str] | None = None,
) -> dict[str, Any] | None:
    with _lock:
        _import_local_file()
        chat = _get_chat(chat_id)
        if chat is None:
            return None
        if title is not None and title.strip():
            chat["title"] = title.strip()
        if graph_ids is not None:
            known = {graph["id"] for graph in list_graphs()}
            chat["graph_ids"] = [gid for gid in graph_ids if gid in known]
        chat["updated_at"] = _now()
        _upsert_chat(chat)
        return chat


def delete_chat(chat_id: str) -> bool:
    with _lock:
        _import_local_file()
        if _get_chat(chat_id) is None:
            return False
        name = _ensure_workspace()
        _client().delete(
            collection_name=name,
            points_selector=models.PointIdsList(points=[_chat_point_id(chat_id)]),
            wait=True,
        )
        return True


def append_messages(chat_id: str, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    with _lock:
        _import_local_file()
        chat = _get_chat(chat_id)
        if chat is None:
            return None
        for message in messages:
            chat["messages"].append({"id": uuid4().hex[:12], "created_at": _now(), **message})
        if chat["title"] == "New chat":
            first_user = next((message for message in chat["messages"] if message["role"] == "user"), None)
            if first_user:
                text = first_user["content"].strip()
                chat["title"] = text if len(text) <= 48 else text[:47].rstrip() + "…"
        chat["updated_at"] = _now()
        _upsert_chat(chat)
        return chat
