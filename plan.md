# University Knowledge Graph + Skill-Based Placement System — Build Plan

**Purpose of this document:** Hand this directly to a coding agent (Claude Code, Cursor, etc.) as the spec to implement the project end-to-end.

---

## 1. System Overview

A RAG chatbot for a university that:
- Answers questions about courses, faculty, syllabus, placements using **hybrid search** (dense vector + BM25 sparse vector) over Qdrant.
- Shows a **knowledge graph path** on the frontend explaining *why* an answer/match was given (Cypher traversal in Neo4j).
- Does **skill-based placement matching**: matches student skill profiles to job requirements using vector similarity + graph explainability.
- Runs entirely on free tiers: Vercel (frontend), Railway (backend), Qdrant Cloud (vector DB), Neo4j AuraDB (graph DB), Groq (LLM inference).

**Important correction to keep in the spec:** Qdrant does NOT execute Cypher or native graph traversal. It is vector-only (with sparse vector / BM25-style support). True graph queries (multi-hop, path explanation) require Neo4j (or similar). This plan uses Qdrant for hybrid retrieval and Neo4j for the graph layer, fused together in the backend.

---

## 2. Architecture Diagram (textual)

```
[Next.js Frontend - Vercel]
     |  REST/WebSocket
     v
[FastAPI Backend - Railway]
     |--> Qdrant Cloud (hybrid vector search: dense + sparse/BM25)
     |--> Neo4j AuraDB (Cypher graph traversal, path explanation)
     |--> Groq API (LLM: answer generation, grounded in retrieved context)
     |
     +--> Ingestion pipeline (offline/admin route): docs -> chunks -> embeddings -> Qdrant
                                                    -> entities/relations -> Neo4j
```

---

## 3. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | Next.js 14 (App Router) + TypeScript + Tailwind | Vercel-native, SSR for fast chat UI |
| Graph visualization | `react-flow` or `vis-network` | Render nodes/edges/path returned by backend |
| Backend | FastAPI (Python 3.11) | Best ecosystem for Qdrant client, embeddings, Neo4j driver, Groq SDK |
| Vector DB | Qdrant Cloud (free tier, 1GB) | Native hybrid search (dense + sparse vectors, RRF fusion) |
| Graph DB | Neo4j AuraDB Free (200k nodes / 400k rels) | Real Cypher, path queries, explainability |
| Embeddings | `sentence-transformers/all-MiniLM-L6-v2` (or `bge-small-en-v1.5`) run locally in backend, OR Groq/HF hosted embeddings if available | Free, no extra API cost |
| Sparse/BM25 | Qdrant's built-in sparse vector support (`Qdrant/bm25` or `SPLADE`), or `rank_bm25` computed at index time | Hybrid retrieval |
| LLM | Groq API — Llama 3.3 70B or Llama 3.1 8B (cost/speed tradeoff) | Fast, free-tier friendly |
| Auth (optional) | Clerk / Supabase Auth free tier | Student/admin login |
| Backend deploy | Railway (free tier, watch sleep/hour limits) | Simple Docker deploy |
| Frontend deploy | Vercel free tier | Native Next.js hosting |

---

## 4. Data Model

### 4.1 Qdrant Collections

**Collection: `documents`**
```json
{
  "id": "uuid",
  "vector": {
    "dense": [...],      // 384-dim MiniLM embedding
    "sparse": {"indices": [...], "values": [...]}  // BM25/SPLADE sparse
  },
  "payload": {
    "text": "chunk content",
    "source": "syllabus_cs301.pdf",
    "chunk_index": 3,
    "entity_type": "course | faculty | placement_record | policy",
    "node_id": "neo4j-linked-id",   // links to graph node
    "university": "XYZ",
    "updated_at": "2026-09-01"
  }
}
```

**Collection: `student_skill_vectors`**
```json
{
  "id": "student_id",
  "vector": [...],  // aggregated skill embedding
  "payload": {"student_id": "...", "skills": ["python","react"], "cgpa": 8.2}
}
```

**Collection: `job_requirement_vectors`**
```json
{
  "id": "job_id",
  "vector": [...],
  "payload": {"company": "...", "role": "...", "required_skills": [...]}
}
```

### 4.2 Neo4j Graph Schema

**Nodes:** `Student`, `Course`, `Skill`, `Faculty`, `Company`, `Job`, `Placement`, `Department`

**Relationships:**
```
(Student)-[:ENROLLED_IN]->(Course)
(Course)-[:TEACHES]->(Skill)
(Course)-[:TAUGHT_BY]->(Faculty)
(Student)-[:HAS_SKILL {proficiency: float}]->(Skill)
(Job)-[:REQUIRES]->(Skill)
(Job)-[:OFFERED_BY]->(Company)
(Student)-[:PLACED_AT]->(Placement)-[:AT_COMPANY]->(Company)
(Course)-[:PREREQUISITE_OF]->(Course)
(Department)-[:OFFERS]->(Course)
```

This schema is what powers explainability: e.g. `Student -HAS_SKILL-> Python <-REQUIRES- Job` is a direct path; `Student -ENROLLED_IN-> Course -TEACHES-> Skill <-REQUIRES- Job` explains a skill gained via coursework.

---

## 5. Ingestion Pipeline (build first)

1. **Document loader**: PDF/CSV/DOCX parsers (syllabus, faculty list, placement records, policy docs) → use `unstructured` or `pypdf` + `pandas` for structured data.
2. **Chunking**: 300–500 token chunks with 50-token overlap for unstructured text; structured rows (placement records) become one chunk per row.
3. **Entity extraction**: For structured sources, directly map fields to Neo4j nodes/relations. For unstructured text, use Groq LLM with a structured-output prompt (extract entities: course names, skills, faculty) → JSON → write to Neo4j.
4. **Embedding + upsert to Qdrant**: dense (MiniLM) + sparse (BM25) vectors, with `node_id` payload field pointing to the Neo4j node it corresponds to.
5. **Neo4j write**: `MERGE` nodes/relationships (idempotent) using `neo4j` Python driver, batched with `UNWIND`.
6. Build this as an **admin-only ingestion API route** (`POST /admin/ingest`) plus a CLI script for bulk loading, not just a one-off script — the agent should make it re-runnable.

---

## 5A. Real-Time PDF Extractor & Ingestion Logic (detailed)

Goal: when a PDF is uploaded (admin panel, watched folder, or bulk drop), it should be extracted, chunked, embedded, and written into Qdrant + Neo4j **automatically and incrementally**, with live status visible on the frontend — not a manual offline batch job.

### 5A.1 Upload trigger paths

Support two entry points into the same pipeline:

- **API upload**: `POST /admin/ingest/upload` — multipart file upload from the admin frontend page. Immediately returns a `job_id` and queues processing.
- **Watched folder / bulk drop**: a `watchdog`-based file watcher (or a scheduled poll every N seconds) on a Railway volume / `/data/incoming` directory for bulk-loaded PDFs (e.g. placement office dropping 50 files at once). Each detected file is queued the same way as an API upload.

Both paths push a job onto an **async queue** (see 5A.4) — the HTTP request never blocks on the actual extraction.

### 5A.2 PDF text + structure extraction

Use a layered extraction strategy so the pipeline handles both digital and scanned PDFs:

1. **Fast path — digital PDFs**: `pymupdf` (fitz) to extract text per page, preserving page numbers. Fastest, use first.
2. **Fallback — scanned/image PDFs**: if a page's extracted text is empty or below a character-count threshold (e.g. <20 chars), treat as scanned → run OCR with `pytesseract` on a rasterized page image (`pymupdf` can render page to image).
3. **Tables**: use `pdfplumber` or `camelot` specifically for pages likely to contain tables (placement records, marksheets, timetables) — detect via keyword heuristics (page contains "CGPA", "Company", "Package" etc.) and extract as structured rows rather than raw text, so placement data becomes clean rows instead of noisy paragraph chunks.
4. Tag every extracted unit with `{source_file, page_number, extraction_method: "text"|"ocr"|"table"}` — needed later for accurate citations.

### 5A.3 Real-time chunking + classification

1. Chunk extracted text: 300–500 tokens, 50-token overlap, chunk boundaries respecting paragraph breaks (don't split mid-sentence — use a sentence-aware splitter like `langchain`'s `RecursiveCharacterTextSplitter` or a simple regex-based one).
2. **Document type classification**: run a lightweight Groq call (or keyword-rule fallback for speed) per document to tag it as `syllabus | faculty_list | placement_record | policy | other` — this determines which entity-extraction prompt template and which Neo4j node types to use downstream.
3. Table-extracted rows (placement records) skip generic chunking — each row becomes one atomic chunk directly (already structured).

### 5A.4 Async processing queue (this is the "real-time" part)

- Use **FastAPI `BackgroundTasks`** for MVP, or **Celery + Redis** (Railway supports Redis add-on free tier) if concurrent multi-file throughput matters — recommend starting with `BackgroundTasks` and upgrading to Celery only if the agent hits concurrency issues.
- Each file gets a `job_id` (UUID) with a status record stored in a lightweight table (Postgres on Railway, or even an in-memory dict for MVP demo) with states: `queued → extracting → chunking → embedding → writing_graph → done | failed`.
- Processing per file, step by step, updating status after each step:
  1. Extract (5A.2) → status `extracting`
  2. Chunk + classify (5A.3) → status `chunking`
  3. Embed (dense + sparse) → status `embedding`
  4. Upsert to Qdrant → still `embedding`/`indexing`
  5. Entity-extract + `MERGE` into Neo4j → status `writing_graph`
  6. Mark `done`, store final chunk count + node/edge count created

### 5A.5 Live progress on the frontend

- `GET /admin/ingest/status/{job_id}` — poll-based status endpoint (simplest to build).
- Optional upgrade: **WebSocket** (`/ws/ingest/{job_id}`) or **Server-Sent Events** endpoint pushing status updates as they happen, so the admin page shows a live progress bar (Extracting → Embedding → Graph → Done) instead of polling. Recommend SSE over WebSocket here — simpler with FastAPI (`StreamingResponse`) and sufficient for one-directional status updates.
- Admin UI (`/admin` page): drag-and-drop upload zone → shows per-file progress card → on completion, shows summary ("42 chunks indexed, 18 graph nodes created, 3 pages required OCR").

### 5A.6 Idempotency & re-ingestion

- Hash each PDF (SHA-256 of file bytes) and store it in the status table. If the same file is re-uploaded unchanged, skip reprocessing and return the cached result — important for a "real-time" system where the same syllabus PDF might get dropped into the watched folder repeatedly.
- If a file with the same filename but different hash is uploaded (an updated syllabus version), reprocess and **delete the old Qdrant points + Neo4j nodes tied to that `source_file`** before writing new ones, so stale data doesn't linger (`updated_at` payload field from section 4.1 helps here — query-and-delete by `source == filename` before re-inserting).

### 5A.7 Error handling

- Per-page extraction failures (corrupt page, OCR failure) should not fail the whole document — log the page as `failed`, continue with remaining pages, and surface a partial-success status (`done_with_warnings`) with the failed page numbers listed.
- Wrap Groq calls (entity extraction, classification) with retry + exponential backoff (rate limits are the most likely failure point on free tier) — max 3 retries, then mark that specific step failed without blocking the rest of the file.

### 5A.8 Key libraries to install (backend)

```
pymupdf          # fast digital PDF text extraction
pytesseract       # OCR fallback (needs tesseract binary installed in Docker image)
pdf2image         # or pymupdf's built-in page rasterization, for OCR input
pdfplumber        # table extraction
watchdog          # folder-watch trigger for bulk drops
```
Note: `pytesseract` requires the `tesseract-ocr` system package in the Railway Dockerfile (`apt-get install -y tesseract-ocr`), not just the pip package.

### 5A.9 Updated API surface for this section

| Route | Method | Purpose |
|---|---|---|
| `/admin/ingest/upload` | POST | Upload one or more PDFs, returns `job_id`(s), queues processing |
| `/admin/ingest/status/{job_id}` | GET | Poll processing status |
| `/ws/ingest/{job_id}` or `/admin/ingest/stream/{job_id}` | SSE/WS | Live progress stream (optional upgrade) |
| `/admin/ingest/reprocess/{source_file}` | POST | Force re-ingestion of an already-processed file |

---

## 6. Retrieval + Answer Pipeline (`POST /chat`)

1. Embed user query (dense + sparse).
2. **Qdrant hybrid search**: query `documents` collection with both vectors, fuse with Reciprocal Rank Fusion (RRF), `limit=8`.
3. Extract `node_id`s from top results' payloads.
4. **Neo4j traversal**: for each `node_id`, run a bounded Cypher query (`MATCH path = (n)-[*1..2]-(related) WHERE id(n) = $node_id RETURN path LIMIT 10`) to pull graph context and the path itself.
5. **Context assembly**: merge Qdrant chunk text + Neo4j path descriptions into a structured prompt.
6. **Groq call**: system prompt instructs the model to answer only from provided context and cite source chunk IDs.
7. **Response payload to frontend**:
```json
{
  "answer": "...",
  "sources": [{"source": "syllabus_cs301.pdf", "chunk_index": 3, "text_snippet": "..."}],
  "graph": {
    "nodes": [{"id": "...", "label": "Course: CS301"}, ...],
    "edges": [{"from": "...", "to": "...", "type": "TEACHES"}]
  }
}
```
8. Frontend renders answer + citation list + `react-flow` graph using the `graph` field.

---

## 7. Skill-Based Placement Matching (`POST /match/student/{id}`)

1. Fetch student's skill vector from `student_skill_vectors`.
2. Qdrant similarity search against `job_requirement_vectors`, `top_k=10`.
3. For each candidate job match, run a Neo4j Cypher query to build the explanation path:
```cypher
MATCH p = (s:Student {id:$student_id})-[:HAS_SKILL|ENROLLED_IN|TEACHES*1..3]-(j:Job {id:$job_id})
RETURN p LIMIT 5
```
4. Return ranked matches with similarity score + explanation path + missing-skill gap analysis (skills the job requires that the student's `HAS_SKILL` set doesn't cover — computed via Cypher `WHERE NOT`).
5. Frontend: matches list + "why this match" graph expand-on-click.

---

## 8. API Surface (FastAPI)

| Route | Method | Purpose |
|---|---|---|
| `/chat` | POST | Main RAG chatbot endpoint |
| `/match/student/{id}` | GET | Placement matches for a student |
| `/admin/ingest` | POST | Trigger ingestion of new documents |
| `/graph/node/{id}` | GET | Fetch node + immediate neighbors (for frontend graph expand) |
| `/health` | GET | Railway healthcheck |

---

## 9. Frontend Pages (Next.js)

- `/chat` — chatbot UI: message list, source citations panel, graph visualization panel (split view)
- `/placement` — student dashboard: skill profile, ranked job matches, gap analysis
- `/admin` — document upload + ingestion status (optional, can be CLI-only for MVP)
- Graph panel component: `react-flow` rendering nodes/edges from `/chat` or `/graph/node/{id}` response, click-to-expand neighbors

---

## 10. Build Order (give this to the coding agent as milestones)

1. **Scaffold**: FastAPI backend skeleton + Next.js frontend skeleton, both deployable (empty "hello world" deploy to Railway + Vercel first, to validate the pipeline before writing logic).
2. **Provision**: Qdrant Cloud cluster + collections created via script; Neo4j AuraDB instance + constraints/indexes created via script.
3. **Ingestion pipeline**: loaders → chunker → entity extractor → Qdrant upsert + Neo4j write. Test with a small sample dataset (5–10 documents) end-to-end.
3A. **Real-time PDF extraction (Section 5A)**: build the upload endpoint + async queue + status tracking first with a single test PDF (digital, no OCR needed), then add OCR fallback, table extraction, and SSE progress streaming as follow-ups — don't build all of 5A at once.
4. **Retrieval pipeline**: hybrid Qdrant search + RRF fusion, verify results manually before adding graph/LLM.
5. **Graph traversal**: Neo4j path queries wired to retrieval results.
6. **Groq integration**: prompt template + citation-grounded answer generation.
7. **`/chat` endpoint**: full pipeline wired together, tested via curl/Postman.
8. **Frontend chat UI**: connect to `/chat`, render answer + sources.
9. **Graph visualization**: react-flow component consuming `graph` field.
10. **Placement matching**: student/job vector collections + `/match` endpoint + Cypher explanation queries.
11. **Placement frontend**: dashboard + gap analysis UI.
12. **Polish**: loading states, error handling, rate-limit handling for Groq/Railway free tier, seed script for demo data.

---

## 11. Free-Tier Constraints to Design Around

- **Railway free tier**: limited monthly hours — backend may sleep; add a lightweight `/health` keepalive or accept cold starts.
- **Qdrant Cloud free**: 1GB storage — keep embeddings at 384-dim (MiniLM) not 1536-dim, chunk conservatively.
- **Neo4j AuraDB free**: 200k nodes/400k relationships — plenty for one university's data, but avoid storing full document text as node properties (keep that in Qdrant payload only).
- **Groq free tier**: rate limits per minute — add request queuing/backoff in the backend, not the frontend.

---

## 12. Environment Variables (backend)

```
QDRANT_URL=
QDRANT_API_KEY=
NEO4J_URI=
NEO4J_USER=
NEO4J_PASSWORD=
GROQ_API_KEY=
EMBEDDING_MODEL=all-MiniLM-L6-v2
WATCH_FOLDER_PATH=/data/incoming
POSTGRES_URL=            # for ingestion job status table (or swap for a simpler store)
```