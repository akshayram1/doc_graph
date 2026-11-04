from fastapi import APIRouter, Depends, HTTPException

from app.config import Settings, get_settings
from app.schemas import (
    ChatCreate,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ChatSend,
    ChatSession,
    ChatSummary,
    ChatTurn,
    ChatUpdate,
    StoredMessage,
)
from app.services import registry
from app.services.chat import answer_question

router = APIRouter(prefix="/api", tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
async def chat(
    request: ChatRequest,
    settings: Settings = Depends(get_settings),
) -> ChatResponse:
    """Stateless chat. Prefer the /chats session endpoints."""
    limit = request.limit or settings.retrieval_limit
    return await answer_question(request.message, limit, request.history, request.graph_ids)


@router.get("/chats", response_model=list[ChatSummary])
def list_chats() -> list[ChatSummary]:
    return [ChatSummary(**chat) for chat in registry.list_chats()]


@router.post("/chats", response_model=ChatSession)
def create_chat(request: ChatCreate) -> ChatSession:
    return ChatSession(**registry.create_chat(request.title, request.graph_ids))


def _require(chat_id: str) -> dict:
    chat = registry.get_chat(chat_id)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return chat


@router.get("/chats/{chat_id}", response_model=ChatSession)
def get_chat(chat_id: str) -> ChatSession:
    return ChatSession(**_require(chat_id))


@router.patch("/chats/{chat_id}", response_model=ChatSession)
def update_chat(chat_id: str, request: ChatUpdate) -> ChatSession:
    chat = registry.update_chat(chat_id, title=request.title, graph_ids=request.graph_ids)
    if chat is None:
        raise HTTPException(status_code=404, detail="Chat not found")
    return ChatSession(**chat)


@router.delete("/chats/{chat_id}")
def delete_chat(chat_id: str) -> dict[str, str]:
    if not registry.delete_chat(chat_id):
        raise HTTPException(status_code=404, detail="Chat not found")
    return {"id": chat_id}


@router.post("/chats/{chat_id}/messages", response_model=ChatTurn)
async def send_message(
    chat_id: str,
    request: ChatSend,
    settings: Settings = Depends(get_settings),
) -> ChatTurn:
    chat = _require(chat_id)
    message = request.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message is empty")

    if request.graph_ids is not None:
        chat = registry.update_chat(chat_id, graph_ids=request.graph_ids) or chat
    graph_ids = chat["graph_ids"]
    if not graph_ids:
        raise HTTPException(status_code=400, detail="Select at least one document graph for this chat.")

    history = [ChatMessage(role=m["role"], content=m["content"]) for m in chat["messages"]]
    reply = await answer_question(message, settings.retrieval_limit, history, graph_ids)

    updated = registry.append_messages(
        chat_id,
        [
            {"role": "user", "content": message, "graph_ids": graph_ids, "sources": []},
            {
                "role": "assistant",
                "content": reply.answer,
                "graph_ids": graph_ids,
                "sources": [source.model_dump() for source in reply.sources],
            },
        ],
    )
    if updated is None:
        raise HTTPException(status_code=404, detail="Chat was deleted while answering")

    return ChatTurn(chat=ChatSession(**updated), reply=StoredMessage(**updated["messages"][-1]))
