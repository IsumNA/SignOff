# Architecture

This document is the technical companion to the [README](../README.md). It
explains how a review runs end-to-end, how each backend module is responsible
for one thing, and how the transparency, audit, and learning layers work.

---

## 1. System shape

```
Frontend (TanStack Start, React 19)              Backend (FastAPI, async)
  src/routes/*  — one file per screen      ◄────►   main.py — HTTP surface
  src/lib/api.ts — typed API contract               mesh.py — review orchestration
                                                     tools.py — individual reviewers
                                                     insights.py — portfolio learning
                                                     audit.py / events.py — record & stream
                                                     matters.py — ledger + lifecycle
                                                     config.py — settings + live/demo
```

The frontend never calls a model directly. It calls the FastAPI backend, which
owns all model/integration access, credentials, and the audit trail.

---

## 2. A clause review, end to end

When a supervisor opens a clause in the Review workspace, the UI does two things
at once:

1. Opens an **SSE stream** (`GET /api/trace/{session_id}/stream`) so it can show
   each reviewer light up live.
2. Sends the clause to `POST /api/chat`.

Inside the backend (`mesh.py → run_mesh`):

```
run_mesh(message, session_id, jurisdiction, clause_type)
  │
  ├─ asyncio.gather(  ← all four run in parallel
  │     assess_local_risk()        → NVIDIA Nemotron (confidential risk)
  │     query_precedents()         → Neo4j precedent graph
  │     search_eu_legislation()    → EU Publications Office (Cellar SPARQL, live)
  │     research_clause()          → Perplexity (live legal research)
  │  )
  │     each tool publishes a "running" then a "success/failed" trace frame
  │
  ├─ synthesis:
  │     Gemini 2.5 Flash fuses the signals into strict JSON
  │     (tier, recommended posture, confidence, per-reviewer reasoning)
  │     — falls back to a deterministic demo synthesis if Vertex isn't live
  │
  ├─ events.mark_done(session_id)   ← closes the SSE stream
  └─ returns ChatResponse {classification, agents[], evidence[], traces[]}
```

The response shape is mirrored exactly by `frontend/src/lib/api.ts`, so the
contract between the two halves lives in one typed place.

---

## 3. Backend modules (each does one job)

| Module | Responsibility |
| --- | --- |
| `main.py` | The FastAPI app and **every HTTP route**. Thin: validates input (Pydantic), calls a module, writes an audit record. Start here to see the API surface. |
| `mesh.py` | Orchestrates the parallel review and the Gemini synthesis. Publishes trace frames as each step runs. Contains both the live and the deterministic demo synthesis. |
| `tools.py` | The individual reviewers, one async function each: Neo4j precedents, EU Cellar SPARQL, Perplexity research, NVIDIA Nemotron risk. Each degrades to a structured error or demo payload instead of raising. |
| `insights.py` | Portfolio learning. `portfolio_insights()` derives cross-matter patterns to scrutinise; `suggest_plan()` recommends a setup for a new matter from comparable matters. |
| `audit.py` | The tamper-proof audit log (see §4). |
| `events.py` | An in-process per-session event bus that backs the live SSE traces (see §5). |
| `matters.py` | The matter ledger, lifecycle stages, and Coordinate-board workstreams (demo data). |
| `config.py` | Settings (`pydantic-settings`), lazily-initialised clients, and the `*_is_live()` helpers that decide live vs demo. |

---

## 4. Auditability — the hash chain

`audit.py` is an append-only log where each record embeds the SHA-256 hash of
the previous record:

```
record.hash = sha256( canonical(record without its own hash) )
record.prev_hash = previous record's hash
```

Because each link depends on the one before it, **any** later edit, deletion, or
reordering changes a hash and breaks the chain. `verify_chain()` recomputes the
whole chain on demand (`GET /api/audit/verify`), and the UI re-verifies on every
read — so integrity is *proven*, not asserted.

- Always persisted locally to `audit_log.jsonl` (works with no cloud).
- Mirrored to **Firestore** for durable, multi-instance storage when configured.
- Every analysis, plan, and sign-off is recorded, attributed to the actual
  models/services that ran (e.g. "NVIDIA Nemotron, Google Gemini, …"), and
  sign-offs record whether the supervisor **overrode** the AI.

---

## 5. Transparency — live traces over SSE

`events.py` is a lightweight publish/subscribe bus keyed by `session_id`:

- `mesh.py` calls `events.publish(...)` with a `running` frame the instant a
  reviewer starts, and a terminal `success`/`failed` frame when it resolves.
- The UI subscribes via `GET /api/trace/{session_id}/stream`
  (`text/event-stream`). Late subscribers get the history replayed, then live
  frames; `mark_done` closes the stream.

The result: the supervisor watches each model/source run in real time, with its
live/demo mode, latency, and status — the review is a glass box, not a spinner.

---

## 6. Portfolio learning

`insights.py` turns the portfolio into a source of supervisory intelligence,
reading live from `matters.py` and `audit.py` so it adapts as matters are added.

- **Scrutiny (`portfolio_insights`)** surfaces cross-matter patterns: critical
  blocker exceptions, matters drifting below their practice-area compliance band,
  escalations awaiting the partner, the most common critical-risk area, and how
  often partners override the AI.
- **Proactive planning (`suggest_plan`)** blends a per-practice-area playbook
  with what comparable matters actually used — recommending a compliance
  threshold (drawn from how those matters cleared), reviewers, scope, red-lines,
  and likely risk hotspots. **Confidence rises with the number of comparable
  matters**, which is the demonstrable "improves over time" behaviour.

---

## 7. Live vs demo

`config.py` exposes `integration_status()` and per-integration `*_is_live()`
checks. The rule throughout the codebase:

- No credentials → **demo mode**: deterministic local output, clearly labelled.
- Credentials present → **live**: real model/source, labelled live.

This is surfaced on `GET /api/health`, on every trace frame, and on every
recommendation — so a judge can always see exactly what is real.

---

## 8. Deployment

The backend is a single container (`backend/Dockerfile`) targeting **Cloud
Run**, which injects `PORT`. Locally it binds `:8000` (the frontend dev server
uses `:8080`, allowed by CORS). The frontend is a standard TanStack Start build.
