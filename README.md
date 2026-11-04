# Finsk

Finsk is a university knowledge graph and skill-based placement system with a FastAPI backend and a Next.js frontend.

## Project Structure

```text
Finsk/
├── .env              # single env file for backend and frontend
├── Makefile          # make install / make run
├── backend/          # FastAPI API, Qdrant search & Groq LLM integration
└── frontend/         # Next.js web application
```

---

## Quick start

From the project root:

```bash
make install
make run
```

`make install` creates `backend/.venv`, installs Python packages, and installs the frontend npm packages.

`make run` starts the backend and the frontend together. Ctrl+C stops both.

- Frontend: http://localhost:3000
- Backend: http://127.0.0.1:8000
- API docs: http://127.0.0.1:8000/docs

## How it works

- **Workspace (`/`)**: every uploaded PDF or CSV becomes its own *document graph*. From here you add documents and open chat windows. Tick several document cards to start one chat across all of them.
- **Chat (`/chat/<id>`)**: each chat is scoped to the graphs ticked in the "Chatting with" bar, and you can change that at any time. Answers come only from those graphs. When several are selected, entities that appear in more than one document are linked and passed to the model. Source chips jump to the node in the graph beside the chat.
- **Graph explorer (`/graph?ids=a,b`)**: a full-screen graph for any set of documents. Layouts: Network, By document, By type. You also get search, type filters, and a node inspector.

Nodes live in Qdrant tagged with `graph_id`. Document and chat metadata (names, colours, message history) is stored in `backend/data/workspace.json`.

## Environment

One file, at the project root: `.env`.

```bash
cp .env.example .env
```

Fill in the Qdrant and Groq keys. The backend and the frontend both read that file. `NEXT_PUBLIC_API_URL` is the address the browser uses to call the API.

Do not commit `.env`. It stays on your machine. The repo only includes `.env.example`, which has placeholders.
