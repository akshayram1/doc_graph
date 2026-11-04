"""Local JSON store for document graphs and chat sessions.

Qdrant holds the nodes; this file holds the metadata around them: which documents
exist (one graph per document) and which chats exist, with the graphs each chat
is scoped to and its message history.
"""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

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


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _empty() -> dict[str, Any]:
    return {"graphs": [], "chats": []}


def _load() -> dict[str, Any]:
    if not STORE_PATH.exists():
        return _empty()
    try:
        data = json.loads(STORE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return _empty()
    data.setdefault("graphs", [])
    data.setdefault("chats", [])
    return data


def _save(data: dict[str, Any]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = STORE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    tmp.replace(STORE_PATH)


def _next_color(graphs: list[dict[str, Any]]) -> str:
    used = {g.get("color") for g in graphs}
    for color in GRAPH_COLORS:
        if color not in used:
            return color
    return GRAPH_COLORS[len(graphs) % len(GRAPH_COLORS)]


# ---------------------------------------------------------------- graphs


def list_graphs() -> list[dict[str, Any]]:
    with _lock:
        return _load()["graphs"]


def get_graph(graph_id: str) -> dict[str, Any] | None:
    with _lock:
        return next((g for g in _load()["graphs"] if g["id"] == graph_id), None)


def create_graph(
    name: str,
    filename: str,
    node_count: int,
    edge_count: int,
    graph_id: str | None = None,
) -> dict[str, Any]:
    with _lock:
        data = _load()
        graph = {
            "id": graph_id or uuid4().hex[:12],
            "name": name,
            "filename": filename,
            "color": _next_color(data["graphs"]),
            "node_count": node_count,
            "edge_count": edge_count,
            "created_at": _now(),
        }
        data["graphs"].append(graph)
        _save(data)
        return graph


def delete_graph(graph_id: str) -> bool:
    with _lock:
        data = _load()
        before = len(data["graphs"])
        data["graphs"] = [g for g in data["graphs"] if g["id"] != graph_id]
        for chat in data["chats"]:
            chat["graph_ids"] = [gid for gid in chat["graph_ids"] if gid != graph_id]
        _save(data)
        return len(data["graphs"]) != before


def clear_graphs() -> None:
    with _lock:
        data = _load()
        data["graphs"] = []
        for chat in data["chats"]:
            chat["graph_ids"] = []
        _save(data)


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


def list_chats() -> list[dict[str, Any]]:
    with _lock:
        chats = sorted(_load()["chats"], key=lambda c: c["updated_at"], reverse=True)
        return [_summary(c) for c in chats]


def get_chat(chat_id: str) -> dict[str, Any] | None:
    with _lock:
        return next((c for c in _load()["chats"] if c["id"] == chat_id), None)


def create_chat(title: str | None, graph_ids: list[str]) -> dict[str, Any]:
    with _lock:
        data = _load()
        known = {g["id"] for g in data["graphs"]}
        now = _now()
        chat = {
            "id": uuid4().hex[:12],
            "title": (title or "").strip() or "New chat",
            "graph_ids": [gid for gid in graph_ids if gid in known],
            "created_at": now,
            "updated_at": now,
            "messages": [],
        }
        data["chats"].append(chat)
        _save(data)
        return chat


def update_chat(
    chat_id: str,
    title: str | None = None,
    graph_ids: list[str] | None = None,
) -> dict[str, Any] | None:
    with _lock:
        data = _load()
        chat = next((c for c in data["chats"] if c["id"] == chat_id), None)
        if chat is None:
            return None
        if title is not None and title.strip():
            chat["title"] = title.strip()
        if graph_ids is not None:
            known = {g["id"] for g in data["graphs"]}
            chat["graph_ids"] = [gid for gid in graph_ids if gid in known]
        chat["updated_at"] = _now()
        _save(data)
        return chat


def delete_chat(chat_id: str) -> bool:
    with _lock:
        data = _load()
        before = len(data["chats"])
        data["chats"] = [c for c in data["chats"] if c["id"] != chat_id]
        _save(data)
        return len(data["chats"]) != before


def append_messages(chat_id: str, messages: list[dict[str, Any]]) -> dict[str, Any] | None:
    with _lock:
        data = _load()
        chat = next((c for c in data["chats"] if c["id"] == chat_id), None)
        if chat is None:
            return None
        for message in messages:
            chat["messages"].append({"id": uuid4().hex[:12], "created_at": _now(), **message})
        if chat["title"] == "New chat":
            first_user = next((m for m in chat["messages"] if m["role"] == "user"), None)
            if first_user:
                text = first_user["content"].strip()
                chat["title"] = text if len(text) <= 48 else text[:47].rstrip() + "…"
        chat["updated_at"] = _now()
        _save(data)
        return chat
