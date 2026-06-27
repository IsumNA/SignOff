"""SignOff backend — FastAPI application.

Serves the asymmetric legal risk mesh and writes a tamper-evident audit trail
to Firestore for every analysis. Designed to run on Cloud Run behind the
Lovable React frontend.

Endpoints:
  GET  /                          — service metadata
  GET  /healthz                   — liveness probe
  POST /api/mesh/analyze-clause   — run the multi-agent mesh on one clause
"""

from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from config import close_neo4j_driver, get_firestore_client, get_settings
from mesh import analyze_clause

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)
logger = logging.getLogger("signoff.main")


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------
class AnalyzeClauseRequest(BaseModel):
    """Incoming payload from the Lovable frontend."""

    clause_text: str = Field(..., min_length=1, description="The clause to analyze.")
    jurisdiction: str = Field("EU", description="Governing-law jurisdiction.")
    clause_type: str = Field(
        "", description="Optional clause type hint (e.g. 'indemnification')."
    )
    deal_id: Optional[str] = Field(
        None, description="Optional deal identifier for audit correlation."
    )
    session_id: Optional[str] = Field(
        None, description="Optional client session id for audit correlation."
    )


class AnalyzeClauseResponse(BaseModel):
    """Structured mesh verdict returned to the frontend."""

    request_id: str
    risk_tier: str
    verdict: Dict[str, Any]
    latency_ms: int


# ---------------------------------------------------------------------------
# Lifespan — warm clients on startup, close drivers on shutdown
# ---------------------------------------------------------------------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    logger.info("SignOff backend starting (project=%s)", settings.gcp_project_id)
    yield
    await close_neo4j_driver()
    logger.info("SignOff backend shut down cleanly")


app = FastAPI(
    title="SignOff — Asymmetric Legal Risk AI Multi-Agent Mesh",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — accept traffic from the Lovable React frontend.
_settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_settings.cors_origins_list,
    allow_origin_regex=r"https://.*\.lovable\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Audit trail (Firestore)
# ---------------------------------------------------------------------------
async def _write_audit_log(entry: Dict[str, Any]) -> None:
    """Persist an audit record to Firestore. Never raises into the request."""
    try:
        client = get_firestore_client()
        collection = get_settings().firestore_audit_collection
        await client.collection(collection).document(entry["request_id"]).set(entry)
        logger.info("Audit log written (request_id=%s)", entry["request_id"])
    except Exception:  # noqa: BLE001 — auditing must not break the response
        logger.exception("Failed to write audit log (request_id=%s)", entry.get("request_id"))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/")
async def root() -> Dict[str, Any]:
    return {
        "service": "SignOff Asymmetric Legal Risk Mesh",
        "status": "ok",
        "model": get_settings().vertex_model,
        "endpoint": "/api/mesh/analyze-clause",
    }


@app.get("/healthz")
async def healthz() -> Dict[str, str]:
    return {"status": "healthy"}


@app.post("/api/mesh/analyze-clause", response_model=AnalyzeClauseResponse)
async def analyze_clause_endpoint(
    payload: AnalyzeClauseRequest,
) -> AnalyzeClauseResponse:
    """Run the asymmetric multi-agent mesh and persist an audit record."""
    request_id = str(uuid.uuid4())
    started = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()

    logger.info(
        "analyze-clause received (request_id=%s, deal_id=%s, jurisdiction=%s)",
        request_id,
        payload.deal_id,
        payload.jurisdiction,
    )

    try:
        verdict = await analyze_clause(
            clause_text=payload.clause_text,
            jurisdiction=payload.jurisdiction,
            clause_type=payload.clause_type,
        )
    except ValueError as exc:
        # Synthesizer produced invalid JSON — treat as upstream/model error.
        logger.exception("Mesh synthesis error (request_id=%s)", request_id)
        await _write_audit_log(
            {
                "request_id": request_id,
                "status": "error",
                "error": str(exc),
                "started_at": started_at,
                "deal_id": payload.deal_id,
                "session_id": payload.session_id,
                "jurisdiction": payload.jurisdiction,
            }
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The risk synthesizer returned an invalid response.",
        ) from exc
    except Exception as exc:  # noqa: BLE001 — top-level API safety net
        logger.exception("Unexpected mesh failure (request_id=%s)", request_id)
        await _write_audit_log(
            {
                "request_id": request_id,
                "status": "error",
                "error": str(exc),
                "started_at": started_at,
                "deal_id": payload.deal_id,
                "session_id": payload.session_id,
                "jurisdiction": payload.jurisdiction,
            }
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal error while analyzing the clause.",
        ) from exc

    latency_ms = int((time.perf_counter() - started) * 1000)
    risk_tier = verdict.get("risk_tier", "Tier 2")

    # Persist the audit trail (signals included for traceability).
    await _write_audit_log(
        {
            "request_id": request_id,
            "status": "success",
            "started_at": started_at,
            "completed_at": datetime.now(timezone.utc).isoformat(),
            "latency_ms": latency_ms,
            "deal_id": payload.deal_id,
            "session_id": payload.session_id,
            "jurisdiction": payload.jurisdiction,
            "clause_type": payload.clause_type,
            "risk_tier": risk_tier,
            "verdict": verdict,
        }
    )

    return AnalyzeClauseResponse(
        request_id=request_id,
        risk_tier=risk_tier,
        verdict=verdict,
        latency_ms=latency_ms,
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True)
