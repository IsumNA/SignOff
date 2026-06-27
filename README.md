# SignOff — Asymmetric Legal Risk AI Multi-Agent Mesh

Backend for **SignOff**, a hybrid multi-agent system that analyzes contract
clauses and returns a structured **risk mitigation tier** (Tier 1 / 2 / 3).

It fans out three *asymmetric* agents in parallel, then fuses their signals in
**Gemini 1.5 Pro** to produce a strict-JSON verdict, while writing a full audit
trail to Firestore.

## Architecture

```
                       ┌────────────────────────────────────────────┐
  Lovable React UI ──► │  FastAPI  /api/mesh/analyze-clause          │
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
| API              | Python **FastAPI** (async)                   |
| Core model       | **Vertex AI — Gemini 1.5 Pro** (strict JSON) |
| High-security    | **NVIDIA NIM** agent (local mock)            |
| Graph / GraphRAG | **Neo4j** (async driver, Cypher)             |
| State / audit    | **GCP Firestore** (async client)             |
| Web grounding    | **Perplexity** (`sonar-reasoning`)           |

## Project layout

```
backend/
  config.py   # Settings + lazy clients (Vertex AI, Firestore, Neo4j)
  tools.py    # Async tools: Neo4j Cypher, Perplexity, NIM (local mock)
  mesh.py     # Asymmetric multi-agent pipeline + Gemini synthesis
  main.py     # FastAPI app, CORS, /api/mesh/analyze-clause, audit logging
```

## Setup

```bash
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Unix:     source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # then fill in real values
```

Authenticate to GCP for Vertex AI + Firestore (local dev):

```bash
gcloud auth application-default login
```

## Run

```bash
cd backend
uvicorn main:app --reload --port 8080
```

Interactive docs: http://localhost:8080/docs

### Example request

```bash
curl -X POST http://localhost:8080/api/mesh/analyze-clause \
  -H "Content-Type: application/json" \
  -d '{
    "clause_text": "The Supplier shall indemnify the Client for unlimited liability...",
    "jurisdiction": "EU",
    "clause_type": "indemnification",
    "deal_id": "DEAL-123"
  }'
```

### Example response (shape)

```json
{
  "request_id": "…",
  "risk_tier": "Tier 1",
  "verdict": {
    "risk_tier": "Tier 1",
    "confidence": 0.86,
    "summary": "…",
    "key_risks": ["…"],
    "recommended_mitigations": ["…"],
    "citations": ["…"],
    "agent_signals": { "nim_severity": "HIGH", "precedent_count": 3, "web_grounded": true }
  },
  "latency_ms": 4210
}
```

## Notes

- **NIM mock**: `NIM_MOCK=true` runs a local deterministic heuristic representing
  on-prem processing of sensitive clauses. Set `NIM_MOCK=false` and point
  `NIM_BASE_URL` at a live NIM container to use real inference.
- **Graceful degradation**: a failure in any single agent returns a structured
  `error` payload instead of crashing; the mesh still produces a best-effort verdict.
- **CORS**: configured for the Lovable frontend via `CORS_ALLOW_ORIGINS` plus a
  regex allowing `*.lovable.app`.
```
