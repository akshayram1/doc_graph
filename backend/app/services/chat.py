from collections.abc import Sequence

import httpx

from app.config import get_settings
from app.schemas import ChatMessage, ChatResponse, SearchHit
from app.services import registry
from app.services.store import fetch_graph, search_nodes

SYSTEM_PROMPT = (
    "You are Finsk AI, an intelligent, friendly, and conversational assistant for the Finsk University Knowledge Graph platform.\n\n"
    "Platform Knowledge Base:\n"
    "- You have access to a rich university knowledge graph in Qdrant containing: students (CGPA, skills), faculty (departments, courses taught), "
    "courses, skills, companies, job roles, and placement records.\n"
    "- When graph context is provided below, synthesize a clear, well-structured, and accurate answer. "
    "Cite the relevant node keys in brackets, e.g. [node-key].\n\n"
    "Conversation & Context Guidelines:\n"
    "- You have full conversational memory of prior messages in the current session. Always understand pronouns and follow-up questions "
    "(such as 'his skills', 'what about him', 'where did she get placed', 'who teaches that') in reference to previously mentioned entities.\n"
    "- If the user greets you (e.g., 'hey', 'hello', 'hey bro', 'hi', 'wassup', 'kya haal hai'), asks how you are, or asks what you can do: "
    "respond warmly, casually, and helpfully! Introduce yourself as Finsk AI, explain that you answer from the document graphs selected for this chat (shown beside the chat), "
    "and suggest 3 concrete sample questions they can try asking.\n"
    "- If the user speaks in Hinglish or informal tone (like 'hey bro', 'bhai', 'batao'), reply in a friendly, conversational tone matching their language vibe.\n"
    "- If the user asks a factual question about the university or graph and no matching nodes are found in the database: "
    "politely explain that no specific records matching their query were found in the graph, and suggest selecting another document graph for this chat or uploading a PDF or CSV.\n"
    "- Format your answers cleanly with markdown: bold names/entities and bullet points for lists."
)


class ChatNotConfigured(RuntimeError):
    pass


def build_context(hits: list[SearchHit], names: dict[str, str]) -> str:
    return "\n\n".join(
        f"[{hit.key}] {hit.label} (document: {names.get(hit.graph_id, hit.graph_id)})\n{hit.text}"
        for hit in hits
    )


def shared_entities(graph_ids: Sequence[str], names: dict[str, str], limit: int) -> str:
    """Entities that show up in more than one selected document, for cross-document questions."""
    graph = fetch_graph(limit, graph_ids)
    by_uid = {node.uid: node for node in graph.nodes}
    groups: dict[str, set[str]] = {}
    labels: dict[str, tuple[str, str]] = {}
    for edge in graph.edges:
        if not edge.cross:
            continue
        a, b = by_uid.get(edge.source), by_uid.get(edge.target)
        if not a or not b:
            continue
        key = a.label.lower()
        labels.setdefault(key, (a.label, a.type))
        groups.setdefault(key, set()).update({a.graph_id, b.graph_id})
    lines = [
        f"- {labels[key][0]} ({labels[key][1]}): in "
        + ", ".join(names.get(gid, gid) for gid in sorted(gids))
        for key, gids in groups.items()
    ]
    return "\n".join(lines[:40])


def scope_note(graph_ids: Sequence[str] | None, names: dict[str, str]) -> str:
    if graph_ids is None:
        return "The user is asking across every uploaded document."
    if not graph_ids:
        return "The user has not selected any document graph for this chat."
    listed = ", ".join(f'"{names.get(gid, gid)}"' for gid in graph_ids)
    if len(graph_ids) == 1:
        return f"The user is chatting with one document graph: {listed}. Answer only from it."
    return (
        f"The user is chatting with {len(graph_ids)} document graphs at once: {listed}. "
        "Say which document each fact comes from, and point out where the documents agree, "
        "differ, or mention the same entity."
    )


async def contextualize_query(message: str, history: Sequence[ChatMessage]) -> str:
    """Resolve pronouns and conversational references into a self-contained search query."""
    if not history:
        return message

    # Filter to last 4 non-empty messages
    recent_history = [m for m in history[-4:] if m.content]
    if not recent_history:
        return message

    formatted_history = "\n".join(f"{m.role}: {m.content}" for m in recent_history)

    prompt = (
        "Given the conversation history and a follow-up query, generate a standalone keyword search query "
        "to retrieve relevant nodes from a knowledge graph database.\n"
        "Replace any pronouns (he, him, his, she, her, they, their, it, this, that) with the specific entity name "
        "it refers to from the chat history. Output ONLY the search query keywords. No quotes, no markdown, no explanations.\n\n"
        f"Chat History:\n{formatted_history}\n\n"
        f"Follow-up Query: {message}\n"
        "Standalone Search Query:"
    )

    settings = get_settings()
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.groq_base_url}/chat/completions",
                headers={"Authorization": f"Bearer {settings.groq_api_key}"},
                json={
                    "model": settings.groq_model,
                    "temperature": 0.0,
                    "max_tokens": 40,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            if resp.status_code == 200:
                body = resp.json()
                resolved = body["choices"][0]["message"]["content"].strip().strip('"').strip("'")
                if resolved and len(resolved) < 120:
                    return resolved
    except Exception:
        pass

    return message


async def answer_question(
    message: str,
    limit: int,
    history: Sequence[ChatMessage] = (),
    graph_ids: Sequence[str] | None = None,
) -> ChatResponse:
    settings = get_settings()

    if not settings.groq_api_key:
        raise ChatNotConfigured("GROQ_API_KEY is not set")

    # 1. Resolve search query using chat history context
    search_query = await contextualize_query(message, history)

    # 2. Search knowledge graph
    hits = search_nodes(search_query, limit, graph_ids)
    valid_hits = [h for h in hits if h.score > 0.0]
    names = {g["id"]: g["name"] for g in registry.list_graphs()}
    context = build_context(valid_hits, names)
    if graph_ids and len(graph_ids) > 1:
        shared = shared_entities(graph_ids, names, settings.graph_node_limit)
        if shared:
            context = f"{context}\n\nEntities that appear in more than one selected document:\n{shared}".strip()

    # 3. Assemble chat prompt with history
    messages_payload: list[dict[str, str]] = [
        {"role": "system", "content": f"{SYSTEM_PROMPT}\n\nScope: {scope_note(graph_ids, names)}"}
    ]

    # Include recent conversation turns (up to 6)
    for prev in history[-6:]:
        if prev.role in ("user", "assistant") and prev.content:
            messages_payload.append({"role": prev.role, "content": prev.content})

    # Add current user message with graph context
    if context:
        user_content = f"Knowledge Graph Context for this question:\n{context}\n\nUser Question: {message}"
    else:
        user_content = f"User Question: {message}\n(Note: No matching graph nodes found in database for this query)"

    messages_payload.append({"role": "user", "content": user_content})

    payload = {
        "model": settings.groq_model,
        "temperature": 0.5,
        "messages": messages_payload,
    }

    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(
            f"{settings.groq_base_url}/chat/completions",
            headers={"Authorization": f"Bearer {settings.groq_api_key}"},
            json=payload,
        )
        response.raise_for_status()
        body = response.json()

    return ChatResponse(
        answer=body["choices"][0]["message"]["content"],
        model=body.get("model", settings.groq_model),
        sources=valid_hits,
    )
