import asyncio
import io
import json
import re
from collections.abc import Sequence

import httpx
import pandas as pd
from pypdf import PdfReader

from app.config import get_settings
from app.schemas import NodeInput, Relation

EXTRACTION_SYSTEM_PROMPT = (
    "You are an expert Knowledge Graph architect. Your task is to extract structured knowledge graph "
    "entities and their relationships from unstructured text.\n\n"
    "Output Requirements:\n"
    "- Return ONLY a valid JSON array of node objects. Do NOT include markdown code blocks or any other commentary.\n"
    "- Each node object MUST have this exact schema:\n"
    "  {\n"
    '    "key": "unique-kebab-case-slug",\n'
    '    "label": "Human Readable Title",\n'
    '    "type": "student|faculty|course|skill|company|job|placement|department|concept|project",\n'
    '    "text": "Rich factual summary sentence(s) describing this entity based on the text",\n'
    '    "relations": [\n'
    '      {"target": "target-entity-key", "type": "relationship_name"}\n'
    "    ]\n"
    "  }\n\n"
    "Guidelines:\n"
    "1. Keys must be normalized slugs (e.g. 'hassan-ali', 'machine-learning', 'google', 'cs101').\n"
    "2. Relation targets must reference the keys of other entities.\n"
    "3. Keep relationship types concise verbs/prepositions (e.g. 'teaches', 'has_skill', 'enrolled_in', 'works_at', 'requires', 'part_of').\n"
    "4. Extract as many meaningful entities and connections as possible."
)


def extract_text_from_pdf(file_bytes: bytes) -> str:
    try:
        reader = PdfReader(io.BytesIO(file_bytes), strict=False)
    except Exception as exc:
        raise ValueError(f"Could not open this PDF. It may be damaged or incomplete. ({exc})") from exc

    pages_text: list[str] = []
    for page_idx, page in enumerate(reader.pages):
        try:
            text = page.extract_text() or ""
        except Exception:
            text = ""
        if text.strip():
            pages_text.append(f"--- Page {page_idx + 1} ---\n{text.strip()}")
    return "\n\n".join(pages_text)


def extract_text_from_csv(file_bytes: bytes) -> str:
    df = pd.read_csv(io.BytesIO(file_bytes))
    lines: list[str] = []
    columns = [str(c).strip() for c in df.columns]

    lines.append(f"Columns: {', '.join(columns)}")
    for idx, row in df.iterrows():
        row_parts: list[str] = []
        for col in columns:
            val = row[col]
            if pd.notna(val) and str(val).strip():
                row_parts.append(f"{col}: {val}")
        if row_parts:
            lines.append(f"Record {idx + 1}: {', '.join(row_parts)}")

    return "\n".join(lines)


def _chunk_text(text: str, max_chunk_size: int = 1600) -> list[str]:
    pieces: list[str] = []
    for para in text.split("\n\n"):
        para = para.strip()
        if not para:
            continue
        if len(para) <= max_chunk_size:
            pieces.append(para)
            continue
        start = 0
        while start < len(para):
            pieces.append(para[start : start + max_chunk_size].strip())
            start += max_chunk_size

    chunks: list[str] = []
    current_chunk: list[str] = []
    current_len = 0

    for piece in pieces:
        piece_len = len(piece)
        if current_len + piece_len > max_chunk_size and current_chunk:
            chunks.append("\n\n".join(current_chunk))
            current_chunk = [piece]
            current_len = piece_len
        else:
            current_chunk.append(piece)
            current_len += piece_len + 2

    if current_chunk:
        chunks.append("\n\n".join(current_chunk))

    return chunks or [text]


def _clean_json_response(raw: str) -> list[dict]:
    cleaned = raw.strip()
    if cleaned.startswith("```json"):
        cleaned = cleaned[7:]
    elif cleaned.startswith("```"):
        cleaned = cleaned[3:]
    if cleaned.endswith("```"):
        cleaned = cleaned[:-3]
    cleaned = cleaned.strip()

    # Try direct parse
    try:
        data = json.loads(cleaned)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Sometimes LLMs wrap in {"nodes": [...]}
            for val in data.values():
                if isinstance(val, list):
                    return val
            return [data]
    except json.JSONDecodeError:
        pass

    # Regex search for [ ... ]
    match = re.search(r"\[\s*\{.*\}\s*\]", cleaned, re.DOTALL)
    if match:
        try:
            data = json.loads(match.group(0))
            if isinstance(data, list):
                return data
        except json.JSONDecodeError:
            pass

    # The model often hits the token cap mid-array. Keep every object that closed.
    start = cleaned.find("[")
    if start >= 0:
        fragment = cleaned[start:]
        last_object = fragment.rfind("}")
        if last_object > 0:
            candidate = fragment[: last_object + 1].rstrip().rstrip(",") + "]"
            try:
                data = json.loads(candidate)
                if isinstance(data, list):
                    return data
            except json.JSONDecodeError:
                pass

    return []


async def extract_entities_from_chunk(chunk: str) -> list[NodeInput]:
    settings = get_settings()

    payload = {
        "model": settings.groq_model,
        "temperature": 0.1,
        # This model spends its token budget on hidden reasoning unless effort is low,
        # and then returns an empty answer. Low effort leaves room for the JSON.
        "reasoning_effort": "low",
        "max_completion_tokens": 2000,
        "messages": [
            {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": f"Extract knowledge graph entities and relations from this text:\n\n{chunk}",
            },
        ],
    }

    async with httpx.AsyncClient(timeout=90) as client:
        body = await _post_chat(client, settings, payload)
        message = body["choices"][0]["message"]
        raw = (message.get("content") or "").strip()
        if not raw:
            # Some models put the JSON in the hidden reasoning channel and leave content empty.
            raw = (message.get("reasoning") or message.get("reasoning_content") or "").strip()

    raw_nodes = _clean_json_response(raw)
    nodes: list[NodeInput] = []

    for item in raw_nodes:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key", "")).strip().lower()
        key = re.sub(r"[^a-z0-9_-]", "-", key).strip("-")
        if not key:
            continue

        label = str(item.get("label", key)).strip()
        node_type = str(item.get("type", "concept")).strip().lower()
        text = str(item.get("text", f"{label} is a {node_type}.")).strip()

        raw_relations = item.get("relations", [])
        relations: list[Relation] = []
        if isinstance(raw_relations, list):
            for r in raw_relations:
                if isinstance(r, dict) and r.get("target"):
                    target_key = re.sub(r"[^a-z0-9_-]", "-", str(r["target"]).strip().lower()).strip("-")
                    rel_type = str(r.get("type", "related_to")).strip().lower()
                    if target_key:
                        relations.append(Relation(target=target_key, type=rel_type))

        nodes.append(
            NodeInput(
                key=key,
                label=label,
                type=node_type,
                text=text,
                relations=relations,
            )
        )

    return nodes


async def process_upload(filename: str, file_bytes: bytes) -> list[NodeInput]:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext == "pdf":
        try:
            raw_text = _clean_up_pdf_text(extract_text_from_pdf(file_bytes))
        except ValueError:
            raw_text = ""
        if len(raw_text.strip()) < 50:
            fallback = _pdfplumber_text(file_bytes)
            if fallback.strip():
                raw_text = _clean_up_pdf_text(fallback)

    elif ext == "csv":
        raw_text = extract_text_from_csv(file_bytes)

    else:
        raise ValueError(f"Unsupported file extension: .{ext}")

    if not raw_text.strip():
        raise ValueError("No readable text was found in this file, so no nodes could be created.")

    chunks = _chunk_text(raw_text, max_chunk_size=4000)
    all_nodes_by_key: dict[str, NodeInput] = {}
    failures: list[Exception] = []

    for chunk in chunks:
        try:
            chunk_nodes = await extract_entities_from_chunk(chunk)
        except Exception as exc:
            failures.append(exc)
            continue
        for node in chunk_nodes:
            if node.key in all_nodes_by_key:
                # Merge relations and append text if distinct
                existing = all_nodes_by_key[node.key]
                existing_targets = {r.target for r in existing.relations}
                for r in node.relations:
                    if r.target not in existing_targets:
                        existing.relations.append(r)
                        existing_targets.add(r.target)
                if node.text not in existing.text:
                    existing.text += f" {node.text}"
            else:
                all_nodes_by_key[node.key] = node

    if not all_nodes_by_key and failures:
        raise failures[-1]
    return list(all_nodes_by_key.values())


def _pdfplumber_text(file_bytes: bytes) -> str:
    try:
        import pdfplumber
    except ImportError:
        return ""
    pages: list[str] = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            if text.strip():
                pages.append(text.strip())
    return "\n\n".join(pages)


async def _post_chat(client: httpx.AsyncClient, settings, payload: dict) -> dict:
    url = f"{settings.groq_base_url}/chat/completions"
    headers = {"Authorization": f"Bearer {settings.groq_api_key}"}

    for attempt in range(3):
        response = await client.post(url, headers=headers, json=payload)
        if response.status_code == 400 and "reasoning_effort" in payload:
            payload = {key: value for key, value in payload.items() if key != "reasoning_effort"}
            continue
        if response.status_code == 429 and attempt < 2:
            await asyncio.sleep(12)
            continue
        response.raise_for_status()
        return response.json()

    response.raise_for_status()
    return response.json()


def _clean_up_pdf_text(text: str) -> str:
    """Clean PDF text without gluing the whole document into one line."""
    if not text.strip():
        return text

    text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text)
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()

