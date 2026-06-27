"""SignOff backend — FastAPI application.

Serves the asymmetric legal risk mesh consumed by the SignOff (Lovable) React
frontend, and writes a tamper-evident audit trail to Firestore. Designed to run
on Cloud Run; runs locally in demo mode without any cloud credentials.

Endpoints (frontend contract):
  GET  /api/health                — integration status (live/demo)
  POST /api/chat                  — run the mesh on a clause / question
  POST /api/signoff               — record a counsel decision to the audit trail

Additional:
  GET  /                          — service metadata
  POST /api/mesh/analyze-clause   — original mesh endpoint (same engine)
"""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import (
    close_neo4j_driver,
    firestore_is_live,
    get_firestore_client,
    get_settings,
    integration_status,
)
import audit
from matters import create_matter, get_matter, list_matters, list_tasks
from mesh import run_mesh

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("signoff.main")


# ---------------------------------------------------------------------------
# Models — mirror src/lib/api.ts on the frontend
# ---------------------------------------------------------------------------
class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1)
    session_id: str = Field(..., min_length=1)
    jurisdiction: str = "EU"
    clause_type: str = ""


class Classification(BaseModel):
    tier: int
    tier_label: str
    escalated: bool
    triggers: List[str]
    recommended_posture: str
    confidence: float


class AgentResult(BaseModel):
    agent: str
    model: str
    summary: str
    mode: str
    findings: List[str]
    stance: str
    phase: str
    assumptions: List[str]
    red_flags: List[str]
    reasoning: str


class EvidenceItem(BaseModel):
    kind: str
    title: str
    source: str
    detail: str
    url: str


class Trace(BaseModel):
    id: str
    session_id: str
    agent: str
    tool: str
    status: str
    detail: str
    mode: str
    started_at: str
    finished_at: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)


class ChatResponse(BaseModel):
    session_id: str
    answer: str
    classification: Classification
    agents: List[AgentResult]
    evidence: List[EvidenceItem]
    traces: List[Trace]
    created_at: str


class HealthResponse(BaseModel):
    status: str
    integrations: Dict[str, str]


class MatterBlocker(BaseModel):
    count: int
    tier: int
    label: str


class Matter(BaseModel):
    id: str
    name: str
    asset_class: str
    deal_size: str
    agents_deployed: List[str]
    compliance_envelope: int
    blockers: MatterBlocker
    status: str
    stage: str
    action: str


class LedgerSummary(BaseModel):
    total_matters: int
    total_blockers: int
    avg_envelope: int
    ready_to_sign: int


class MattersResponse(BaseModel):
    matters: List[Matter]
    summary: LedgerSummary


class MatterCreate(BaseModel):
    """Plan-stage payload: define a matter, its risk envelope, and the agents."""

    name: str = Field(..., min_length=1)
    asset_class: str = "M&A"
    deal_size: str = "—"
    jurisdiction: str = "English law"
    agents_deployed: List[str] = Field(default_factory=list)
    scope: List[str] = Field(default_factory=list)
    redlines: List[str] = Field(default_factory=list)
    envelope_target: int = 100
    escalation_tier: int = 3


class Task(BaseModel):
    id: str
    ref: str
    title: str
    column: str
    agent: str
    tier: int
    flagged: bool
    note: str = ""


class TasksResponse(BaseModel):
    matter_id: str
    matter_name: str
    stage: str
    columns: List[str]
    tasks: List[Task]
    counts: Dict[str, int]


class SignOffRequest(BaseModel):
    session_id: str = Field(..., min_length=1)
    posture: str
    rationale: str = Field(..., min_length=1)
    tier: int
    author: str = "Lead Counsel"
    # Snapshot context so the audit record proves WHAT was decided on.
    matter_id: Optional[str] = None
    clause_ref: Optional[str] = None
    clause_title: Optional[str] = None


class SignOffRecord(BaseModel):
    id: str
    session_id: str
    posture: str
    rationale: str
    tier: int
    author: str
    signed_at: str


class AuditRecord(BaseModel):
    seq: int
    id: str
    type: str
    matter_id: Optional[str] = None
    session_id: Optional[str] = None
    actor: str
    summary: str
    data: Dict[str, Any]
    timestamp: str
    prev_hash: str
    hash: str


class AuditResponse(BaseModel):
    events: List[AuditRecord]
    count: int
    verified: bool
    stats: Dict[str, Any]


class VerifyResponse(BaseModel):
    ok: bool
    count: int
    broken_at: Optional[int] = None


class AnalyzeClauseRequest(BaseModel):
    clause_text: str = Field(..., min_length=1)
    jurisdiction: str = "EU"
    clause_type: str = ""
    deal_id: Optional[str] = None
    session_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Lifespan
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info(
        "SignOff backend starting (project=%s, integrations=%s)",
        settings.gcp_project_id,
        integration_status(),
    )
    yield
    await close_neo4j_driver()
    logger.info("SignOff backend shut down cleanly")


app = FastAPI(
    title="SignOff — Asymmetric Legal Risk AI Multi-Agent Mesh",
    version="1.0.0",
    lifespan=lifespan,
)

_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,
    allow_origin_regex=r"https://.*\.lovable\.(app|dev)",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Audit trail — local hash chain (always) + Firestore mirror (when live)
# ---------------------------------------------------------------------------
async def _mirror_to_firestore(entry: Dict[str, Any]) -> None:
    """Best-effort durable mirror of an audit record. Never raises."""
    if not firestore_is_live():
        return
    try:
        client = get_firestore_client()
        collection = get_settings().firestore_audit_collection
        doc_id = entry.get("id") or str(uuid.uuid4())
        await client.collection(collection).document(doc_id).set(entry)
        logger.info("Audit log mirrored to Firestore (id=%s)", doc_id)
    except Exception:  # noqa: BLE001 — auditing must not break the response
        logger.exception("Failed to mirror audit log (id=%s)", entry.get("id"))


async def _audit(
    event_type: str,
    *,
    matter_id: Optional[str] = None,
    session_id: Optional[str] = None,
    actor: str = "system",
    summary: str = "",
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Append a tamper-evident record to the local hash chain, then mirror it to
    Firestore when configured. The local chain is always the source of truth."""
    record = audit.record_event(
        event_type,
        matter_id=matter_id,
        session_id=session_id,
        actor=actor,
        summary=summary,
        data=data,
    )
    await _mirror_to_firestore(record)
    return record


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "service": "SignOff Asymmetric Legal Risk Mesh",
        "status": "ok",
        "model": get_settings().vertex_model,
        "endpoints": [
            "/api/health",
            "/api/matters",
            "/api/chat",
            "/api/signoff",
            "/api/audit",
            "/api/audit/verify",
        ],
    }


@app.get("/api/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    integrations = integration_status()
    return HealthResponse(status="ok", integrations=integrations)


@app.get("/api/audit", response_model=AuditResponse)
async def get_audit(matter_id: Optional[str] = None, limit: int = 200) -> AuditResponse:
    """Read back the tamper-evident audit trail (optionally scoped to a matter)."""
    events = audit.list_events(matter_id=matter_id, limit=limit)
    verification = audit.verify_chain()
    return AuditResponse(
        events=[AuditRecord(**e) for e in events],
        count=verification["count"],
        verified=verification["ok"],
        stats=audit.stats(),
    )


@app.get("/api/audit/verify", response_model=VerifyResponse)
async def verify_audit() -> VerifyResponse:
    """Recompute the hash chain and prove whether the trail is intact."""
    return VerifyResponse(**audit.verify_chain())


@app.get("/api/matters", response_model=MattersResponse)
async def matters() -> MattersResponse:
    """Multi-matter risk ledger — the partner's portfolio command center."""
    return MattersResponse(**list_matters())


@app.post("/api/matters", response_model=Matter, status_code=201)
async def new_matter(payload: MatterCreate) -> Matter:
    """Plan stage — register a supervised matter, define its envelope, deploy agents."""
    created = create_matter(payload.model_dump())
    await _audit(
        "matter_planned",
        matter_id=created["id"],
        actor="system",
        summary=f"Matter planned: {created['name']} ({created['asset_class']})",
        data={
            "name": created["name"],
            "asset_class": created["asset_class"],
            "deal_size": created["deal_size"],
            "agents_deployed": created["agents_deployed"],
            "compliance_envelope": created["compliance_envelope"],
            "jurisdiction": created.get("jurisdiction"),
            "redlines": created.get("redlines", []),
        },
    )
    return Matter(**{k: created[k] for k in Matter.model_fields})


@app.get("/api/matters/{matter_id}/tasks", response_model=TasksResponse)
async def matter_tasks(matter_id: str) -> TasksResponse:
    """Coordinate stage — the workstream board for one matter."""
    if get_matter(matter_id) is None:
        raise HTTPException(status_code=404, detail=f"Matter '{matter_id}' not found")
    return TasksResponse(**list_tasks(matter_id))


@app.post("/api/chat", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    """Run the asymmetric mesh on a clause / question and audit the result."""
    try:
        result = await run_mesh(
            message=payload.message,
            session_id=payload.session_id,
            jurisdiction=payload.jurisdiction,
            clause_type=payload.clause_type,
        )
    except Exception as exc:  # noqa: BLE001 — top-level API safety net
        logger.exception("Mesh failure (session=%s)", payload.session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error while analyzing the clause.",
        ) from exc

    cls = result["classification"]
    live_tools = [t["tool"] for t in result.get("traces", []) if t.get("mode") == "live"]
    await _audit(
        "analysis",
        session_id=payload.session_id,
        actor="mesh",
        summary=(
            f"Clause analyzed → Tier {cls['tier']} ({cls['tier_label']}), "
            f"posture {cls['recommended_posture']}"
        ),
        data={
            "tier": cls["tier"],
            "recommended_posture": cls["recommended_posture"],
            "confidence": cls.get("confidence"),
            "jurisdiction": payload.jurisdiction,
            "clause_type": payload.clause_type,
            "evidence_count": len(result.get("evidence", [])),
            "live_tools": live_tools,
        },
    )

    return ChatResponse(**result)


@app.post("/api/signoff", response_model=SignOffRecord)
async def signoff(payload: SignOffRequest) -> SignOffRecord:
    """Record a counsel decision in the tamper-evident audit trail."""
    record = SignOffRecord(
        id=str(uuid.uuid4()),
        session_id=payload.session_id,
        posture=payload.posture,
        rationale=payload.rationale,
        tier=payload.tier,
        author=payload.author,
        signed_at=datetime.now(timezone.utc).isoformat(),
    )

    clause_label = payload.clause_ref or payload.clause_title or "clause"
    await _audit(
        "signoff",
        matter_id=payload.matter_id,
        session_id=payload.session_id,
        actor=payload.author,
        summary=(
            f"{payload.author} signed off {clause_label} → "
            f"{payload.posture.upper()} (Tier {payload.tier})"
        ),
        data={
            "posture": payload.posture,
            "tier": payload.tier,
            "rationale": payload.rationale,
            "clause_ref": payload.clause_ref,
            "clause_title": payload.clause_title,
            "signoff_id": record.id,
        },
    )
    return record


@app.post("/api/mesh/analyze-clause", response_model=ChatResponse)
async def analyze_clause_endpoint(payload: AnalyzeClauseRequest) -> ChatResponse:
    """Original mesh endpoint — same engine, frontend-shaped response."""
    session_id = payload.session_id or str(uuid.uuid4())
    try:
        result = await run_mesh(
            message=payload.clause_text,
            session_id=session_id,
            jurisdiction=payload.jurisdiction,
            clause_type=payload.clause_type,
        )
    except Exception as exc:  # noqa: BLE001
        logger.exception("Mesh failure (session=%s)", session_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error while analyzing the clause.",
        ) from exc

    cls = result["classification"]
    await _audit(
        "analysis",
        matter_id=payload.deal_id,
        session_id=session_id,
        actor="mesh",
        summary=(
            f"Clause analyzed → Tier {cls['tier']} ({cls['tier_label']}), "
            f"posture {cls['recommended_posture']}"
        ),
        data={
            "tier": cls["tier"],
            "recommended_posture": cls["recommended_posture"],
            "jurisdiction": payload.jurisdiction,
            "evidence_count": len(result.get("evidence", [])),
        },
    )
    return ChatResponse(**result)


if __name__ == "__main__":
    import os

    import uvicorn

    # Local dev defaults to 8000 (the frontend dev server uses 8080). Cloud Run
    # injects PORT (8080) via the Dockerfile.
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
