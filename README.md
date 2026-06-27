# SignOff — Asymmetric Legal Risk AI Multi-Agent Mesh

**SignOff** is a document-first AI legal decisioning workspace for live M&A
transactions. It analyzes contract clauses and returns a structured **risk
mitigation tier** (Tier 1 / 2 / 3) with per-agent reasoning, supporting
evidence, and a tamper-evident audit trail.

This repository is a monorepo:

- **`backend/`** — Python FastAPI service running the multi-agent mesh.
- **`frontend/`** — React (TanStack Start) UI, built with Lovable.

The backend fans out three *asymmetric* agents in parallel, then fuses their
signals in **Gemini 1.5 Pro** to produce a strict-JSON verdict.

## Architecture

```
                       ┌────────────────────────────────────────────┐
  frontend/ (React) ─► │  FastAPI  /api/chat                         │
                       │                                            │
                       │   asyncio.gather (asymmetric fan-out):     │
                       │     • NIM local agent  (sensitive, on-prem)│
                       │     • Neo4j GraphRAG   (precedents)        │
                       │     • Perplexity       (live web research) │
                       │                  │                         │
                       │                  ▼                         │
                       │     Gemini 1.5 Pro  (strict JSON verdict)  │
                       │                  │                         │
                       │                  ▼                         │
                       │     Firestore audit trail                  │
                       └────────────────────────────────────────────┘
```

## Tech stack

| Layer            | Technology                                   |
| ---------------- | -------------------------------------------- |
| Frontend         | **React 19 + TanStack Start**, Tailwind, shadcn/ui |
| API              | Python **FastAPI** (async)                   |
| Core model       | **Vertex AI — Gemini 1.5 Pro** (strict JSON) |
| High-security    | **NVIDIA NIM** agent (local mock)            |
| Graph / GraphRAG | **Neo4j** (async driver, Cypher)             |
| State / audit    | **GCP Firestore** (async client)             |
| Web grounding    | **Perplexity** (`sonar-reasoning`)           |

## Project layout

```
SignOff/
├── README.md
├── .gitignore
├── backend/                 # FastAPI multi-agent service
│   ├── requirements.txt
│   ├── .env.example         # copy to .env and fill in
│   ├── Dockerfile           # Cloud Run image
│   ├── .dockerignore
│   ├── config.py            # Settings + lazy clients (Vertex AI, Firestore, Neo4j)
│   ├── tools.py             # Async tools: Neo4j Cypher, Perplexity, NIM (local mock)
│   ├── mesh.py              # Asymmetric multi-agent pipeline + Gemini synthesis
│   └── main.py              # FastAPI app, CORS, /api/health · /api/chat · /api/signoff
└── frontend/                # React UI (Lovable)
    ├── package.json
    ├── .env                 # VITE_API_BASE -> backend URL
    └── src/
```

## Backend

### Setup

```bash
cd backend
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Unix:     source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # then fill in real values
```

For live Vertex AI + Firestore (local dev), authenticate with ADC:

```bash
gcloud auth application-default login
```

### Run

```bash
cd backend
python main.py            # binds 0.0.0.0:8000 for local dev
# or:  uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Interactive docs: http://localhost:8000/docs

> Local dev uses port **8000** for the backend because the frontend dev server
> runs on **8080**. On Cloud Run the container listens on the injected `PORT`.

> The backend runs in **demo mode** out of the box — no GCP, Neo4j, or
> Perplexity credentials required. Each integration flips to **live** when its
> credentials are present in `.env` (see `GET /api/health`).

### Deploy (Cloud Run)

```bash
cd backend
gcloud run deploy signoff-backend --source . --region us-central1 --allow-unauthenticated
```

### API (frontend contract)

The endpoints match `frontend/src/lib/api.ts`:

| Method | Path                       | Purpose                                  |
| ------ | -------------------------- | ---------------------------------------- |
| GET    | `/api/health`              | Integration status (`live` / `demo`)     |
| GET    | `/api/matters`             | Multi-matter risk ledger + portfolio summary |
| POST   | `/api/chat`                | Run the mesh on a clause / question      |
| POST   | `/api/signoff`             | Record a counsel decision (audit trail)  |
| POST   | `/api/mesh/analyze-clause` | Original mesh endpoint (same engine)     |

Example:

```bash
curl -X POST http://127.0.0.1:8000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "The Seller shall indemnify the Buyer for all Losses on an uncapped basis without time limitation.",
    "session_id": "sess-123"
  }'
```

Returns a `classification` (Tier 1/2/3), per-agent `agents[]` reasoning,
supporting `evidence[]`, and tool-call `traces[]`.

**Tier convention** (matches the UI): Tier 1 = Routine (approve), Tier 2 =
Material risk (amend), Tier 3 = Escalation required (reject).

## Frontend

Point the React app at the backend via `frontend/.env`:

```
VITE_API_BASE=http://localhost:8000
```

Then run the dev server (Lovable's config serves it on `:8080`, which the
backend CORS allows):

```bash
cd frontend
npm install   # or: bun install
npm run dev   # or: bun dev   ->  http://localhost:8080
```

## Notes

- **NIM mock**: `NIM_MOCK=true` runs a local deterministic heuristic representing
  on-prem processing of sensitive clauses. Set `NIM_MOCK=false` and point
  `NIM_BASE_URL` at a live NIM container to use real inference.
- **Graceful degradation**: a failure in any single agent returns a structured
  `error` payload instead of crashing; the mesh still produces a best-effort verdict.
- **CORS**: configured for the frontend via `CORS_ALLOW_ORIGINS` plus a regex
  allowing `*.lovable.app` / `*.lovable.dev`.
