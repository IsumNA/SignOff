"""SignOff backend — async agent tools.

These are the I/O-bound capabilities the mesh composes in parallel:

  * :func:`query_precedents`      — Neo4j GraphRAG: retrieve precedent clauses
                                    and their citations via Cypher.
  * :func:`research_clause`       — Perplexity (sonar-reasoning): live, web-
                                    grounded legal research with citations.
  * :func:`assess_local_risk`     — NVIDIA NIM high-security agent (local mock)
                                    for processing sensitive clauses on-prem.

Every function is fully async and defensive: a failure in any single tool
degrades gracefully (returns a structured ``error`` payload) so the mesh can
still produce a best-effort risk assessment.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

import httpx

from config import (
    get_neo4j_driver,
    get_settings,
    neo4j_is_live,
    perplexity_is_live,
)

logger = logging.getLogger("signoff.tools")

# Default timeout for outbound HTTP calls (Perplexity / NIM).
_HTTP_TIMEOUT = httpx.Timeout(45.0, connect=10.0)


# ---------------------------------------------------------------------------
# Neo4j — GraphRAG precedent retrieval
# ---------------------------------------------------------------------------
# Matches precedent clauses related to the requested clause type and returns
# the precedents plus any indemnity / citation relationships they carry.
_PRECEDENT_CYPHER = """
MATCH (c:Clause)
WHERE toLower(c.type) CONTAINS toLower($clause_type)
   OR toLower(c.text) CONTAINS toLower($clause_type)
OPTIONAL MATCH (c)-[r:CITES|HAS_PRECEDENT|INDEMNIFIES]->(p)
RETURN c.id           AS clause_id,
       c.type         AS clause_type,
       c.text         AS clause_text,
       c.risk_tier    AS risk_tier,
       collect(DISTINCT {
           relation: type(r),
           target:   coalesce(p.title, p.name, p.id),
           citation: p.citation
       })              AS precedents
ORDER BY c.risk_tier ASC
LIMIT $limit
"""


async def query_precedents(
    clause_type: str, limit: int = 5
) -> Dict[str, Any]:
    """Run a Cypher query against Neo4j to retrieve precedent context.

    Returns a structured dict the LLM can ground on. On failure it returns a
    payload with an ``error`` key rather than raising, so the mesh keeps going.
    """
    if not neo4j_is_live():
        logger.info("Neo4j not configured; skipping graph query (demo mode)")
        return {
            "source": "neo4j",
            "clause_type": clause_type,
            "precedents": [],
            "mode": "demo",
        }

    driver = get_neo4j_driver()
    settings = get_settings()

    try:
        async with driver.session(database=settings.neo4j_database) as session:
            result = await session.run(
                _PRECEDENT_CYPHER,
                clause_type=clause_type,
                limit=limit,
            )
            records: List[Dict[str, Any]] = [dict(r) async for r in result]

        logger.info(
            "Neo4j precedent query returned %d record(s) for clause_type=%r",
            len(records),
            clause_type,
        )
        return {"source": "neo4j", "clause_type": clause_type, "precedents": records}

    except Exception as exc:  # noqa: BLE001 — defensive: degrade gracefully
        logger.exception("Neo4j precedent query failed")
        return {
            "source": "neo4j",
            "clause_type": clause_type,
            "precedents": [],
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# Perplexity — live web-grounded legal research
# ---------------------------------------------------------------------------
async def research_clause(clause_text: str, jurisdiction: str = "EU") -> Dict[str, Any]:
    """Fetch live, web-grounded legal research via Perplexity sonar-reasoning.

    Returns the model's analysis plus the citation URLs it grounded on. On
    failure, returns a payload with an ``error`` key.
    """
    settings = get_settings()

    if not perplexity_is_live():
        logger.info("Perplexity not configured; skipping live research (demo mode)")
        return {
            "source": "perplexity",
            "analysis": "",
            "citations": [],
            "mode": "demo",
        }

    system_prompt = (
        "You are a legal research assistant. Provide concise, current, "
        "web-grounded analysis of regulatory and litigation risk for the "
        f"given contract clause under {jurisdiction} law. Cite statutes and "
        "case law where relevant."
    )

    payload = {
        "model": settings.perplexity_model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": clause_text},
        ],
    }
    headers = {
        "Authorization": f"Bearer {settings.perplexity_api_key}",
        "Content-Type": "application/json",
    }

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                f"{settings.perplexity_base_url}/chat/completions",
                json=payload,
                headers=headers,
            )
            resp.raise_for_status()
            data = resp.json()

        analysis = (
            data.get("choices", [{}])[0].get("message", {}).get("content", "")
        )
        citations = data.get("citations", []) or []

        logger.info(
            "Perplexity research returned %d citation(s) for jurisdiction=%s",
            len(citations),
            jurisdiction,
        )
        return {
            "source": "perplexity",
            "jurisdiction": jurisdiction,
            "analysis": analysis,
            "citations": citations,
        }

    except Exception as exc:  # noqa: BLE001 — defensive: degrade gracefully
        logger.exception("Perplexity research failed")
        return {
            "source": "perplexity",
            "jurisdiction": jurisdiction,
            "analysis": "",
            "citations": [],
            "error": str(exc),
        }


# ---------------------------------------------------------------------------
# NVIDIA NIM — High-Security Risk Agent (local mock)
# ---------------------------------------------------------------------------
def _mock_nim_assessment(clause_text: str) -> Dict[str, Any]:
    """Deterministic local mock of a NIM container's sensitive-clause analysis.

    Flags high-risk legal signals using a lightweight keyword heuristic so the
    pipeline is fully runnable without a live NIM container. Replace by setting
    ``NIM_MOCK=false`` and pointing ``NIM_BASE_URL`` at a real NIM endpoint.
    """
    high_risk_terms = [
        "unlimited liability",
        "indemnify",
        "indemnification",
        "personal data",
        "uncapped",
        "perpetual",
        "irrevocable",
        "penalty",
        "termination for convenience",
    ]
    lowered = clause_text.lower()
    flags = [t for t in high_risk_terms if t in lowered]

    if len(flags) >= 2:
        severity = "HIGH"
    elif flags:
        severity = "MEDIUM"
    else:
        severity = "LOW"

    return {
        "source": "nim",
        "mode": "mock",
        "severity": severity,
        "flagged_terms": flags,
        "rationale": (
            "Local high-security heuristic over sensitive clause text; "
            f"{len(flags)} risk signal(s) detected."
        ),
        "processed_locally": True,
    }


async def assess_local_risk(clause_text: str) -> Dict[str, Any]:
    """Process a sensitive clause through the NIM high-security agent.

    When ``NIM_MOCK`` is true (default) this runs a local deterministic mock —
    representing on-prem processing where sensitive data never leaves the
    secured boundary. Otherwise it calls a live NIM container.
    """
    settings = get_settings()

    if settings.nim_mock:
        logger.info("NIM running in local mock mode")
        return _mock_nim_assessment(clause_text)

    payload = {
        "model": "nim-legal-risk",
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a high-security on-prem legal risk classifier. "
                    "Return severity (LOW/MEDIUM/HIGH) and flagged risk terms."
                ),
            },
            {"role": "user", "content": clause_text},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.post(
                f"{settings.nim_base_url}/v1/chat/completions", json=payload
            )
            resp.raise_for_status()
            data = resp.json()

        content = (
            data.get("choices", [{}])[0].get("message", {}).get("content", "")
        )
        logger.info("NIM live assessment received")
        return {
            "source": "nim",
            "mode": "live",
            "assessment": content,
            "processed_locally": True,
        }

    except Exception as exc:  # noqa: BLE001 — defensive: degrade gracefully
        logger.exception("NIM live assessment failed; falling back to local mock")
        fallback = _mock_nim_assessment(clause_text)
        fallback["error"] = str(exc)
        fallback["mode"] = "mock-fallback"
        return fallback
