"""SignOff backend — async agent tools.

These are the I/O-bound capabilities the mesh composes in parallel:

  * :func:`query_precedents`      — Neo4j GraphRAG: retrieve precedent clauses
                                    and their citations via Cypher.
  * :func:`research_clause`       — Perplexity (sonar-reasoning): live, web-
                                    grounded legal research with citations.
  * :func:`assess_local_risk`     — NVIDIA NIM / Nemotron high-security agent
                                    (hosted API or self-hosted on-prem container)
                                    with an offline heuristic fallback.

Every function is fully async and defensive: a failure in any single tool
degrades gracefully (returns a structured ``error`` payload) so the mesh can
still produce a best-effort risk assessment.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List

import httpx

from config import (
    get_neo4j_driver,
    get_settings,
    neo4j_is_live,
    nim_is_live,
    perplexity_is_live,
)

logger = logging.getLogger("signoff.tools")

# Default timeout for outbound HTTP calls (Perplexity / NIM).
_HTTP_TIMEOUT = httpx.Timeout(45.0, connect=10.0)

# The public EU Cellar SPARQL endpoint is authoritative but can be slow/variable.
# Cap it tightly so a slow response degrades to "no EU results" instead of
# stalling the whole review (which must stay responsive, especially on a demo).
_EU_TIMEOUT = httpx.Timeout(12.0, connect=6.0)

# NVIDIA's hosted Nemotron endpoint latency is variable (occasionally ~30s+).
# Cap it so a spike degrades to the local mock assessment instead of dominating
# the whole review. The mock is instant and tier-accurate on the demo clauses.
_NIM_TIMEOUT = httpx.Timeout(15.0, connect=6.0)


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
# EU Publications Office (Cellar) — real, web-grounded regulatory context
# ---------------------------------------------------------------------------
# Public SPARQL endpoint over the EU's Common Metadata Model (CDM). No API key
# required — authoritative EU legislation, ideal for grounding regulatory risk.
_EU_CELLAR_ENDPOINT = "http://publications.europa.eu/webapi/rdf/sparql"

# Map clause language → an EU subject area that maps onto real legislation
# titles (contract-mechanics words like "indemnity" don't appear in EU titles).
_EU_KEYWORD_MAP: List[tuple] = [
    (("personal data", "data protection", "gdpr", "privacy", "processing"), "data protection"),
    (("competit", "antitrust", "merger control", "state aid", "cartel", "dominant position"), "competition"),
    (("consumer",), "consumer"),
    (("financial", "securities", "capital market", "investment", "credit institution"), "financial"),
    (("environment", "emission", "climate", "sustainab"), "environmental"),
    (("energy", "electricity", "gas supply"), "energy"),
    (("employment", "worker", "labour", "labor"), "employment"),
    (("intellectual property", "copyright", "trademark", "patent"), "intellectual property"),
    (("anti-money", "money laundering", "sanction", "bribery", "corrupt"), "money laundering"),
]


def _eu_keyword(text: str) -> str:
    low = (text or "").lower()
    for keys, term in _EU_KEYWORD_MAP:
        if any(k in low for k in keys):
            return term
    return "contract"


def _eu_sparql(term: str, limit: int) -> str:
    lang = "<http://publications.europa.eu/resource/authority/language/ENG>"
    return (
        "PREFIX cdm: <http://publications.europa.eu/ontology/cdm#>\n"
        "SELECT DISTINCT ?celex ?title WHERE {\n"
        "  ?expr cdm:expression_belongs_to_work ?work .\n"
        f"  ?expr cdm:expression_uses_language {lang} .\n"
        "  ?expr cdm:expression_title ?title .\n"
        "  ?work cdm:resource_legal_id_celex ?celex .\n"
        # CELEX sector 3 = legislation; types R (regulation) / L (directive).
        '  FILTER(regex(STR(?celex), "^3[0-9]{4}[RL]"))\n'
        f'  FILTER(regex(STR(?title), "{term}", "i"))\n'
        "}\n"
        f"LIMIT {limit}"
    )


async def search_eu_legislation(clause_text: str, limit: int = 4) -> Dict[str, Any]:
    """Retrieve real EU legislation relevant to a clause from the Publications
    Office Cellar SPARQL endpoint (CELEX + title + EUR-Lex link).

    No API key required, so this is a genuinely *live* signal even in demo mode.
    Degrades gracefully to an ``error`` payload so the mesh keeps going.
    """
    term = _eu_keyword(clause_text)
    query = _eu_sparql(term, limit)

    try:
        async with httpx.AsyncClient(timeout=_EU_TIMEOUT) as client:
            resp = await client.get(
                _EU_CELLAR_ENDPOINT,
                params={"query": query},
                headers={"Accept": "application/sparql-results+json"},
            )
            resp.raise_for_status()
            bindings = resp.json().get("results", {}).get("bindings", [])

        results: List[Dict[str, str]] = []
        for b in bindings:
            celex = b.get("celex", {}).get("value", "")
            title = b.get("title", {}).get("value", "")
            if not celex or not title:
                continue
            results.append(
                {
                    "celex": celex,
                    "title": title,
                    "url": (
                        "https://eur-lex.europa.eu/legal-content/EN/TXT/"
                        f"?uri=CELEX:{celex}"
                    ),
                }
            )

        logger.info(
            "EU Cellar returned %d act(s) for subject=%r", len(results), term
        )
        return {"source": "eu_cellar", "query": term, "results": results}

    except Exception as exc:  # noqa: BLE001 — defensive: degrade gracefully
        logger.exception("EU Cellar legislation search failed")
        return {"source": "eu_cellar", "query": term, "results": [], "error": str(exc)}


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
            "Confidential review of the clause text; "
            f"{len(flags)} risk signal(s) detected."
        ),
        "processed_locally": True,
    }


_NIM_SYSTEM = (
    # NVIDIA Nemotron control token: disable the model's reasoning trace so it
    # answers directly with JSON instead of spending the token budget "thinking"
    # (which truncated the verdict and forced a mock fallback).
    "detailed thinking off\n\n"
    "You are a high-security legal risk classifier for contract clauses. "
    "Assess the clause for risk to the party engaging you. Respond with a SINGLE "
    "JSON object and nothing else, matching this schema:\n"
    '{"severity": "LOW" | "MEDIUM" | "HIGH", '
    '"flagged_terms": string[], '
    '"rationale": string}\n'
    "flagged_terms must quote the exact risky phrases from the clause. Keep "
    "rationale to one or two sentences. Do not include any text before or after "
    "the JSON object."
)


def _parse_nim_json(content: str) -> Dict[str, Any] | None:
    """Best-effort extraction of the strict-JSON verdict from the model output."""
    if not content:
        return None
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", content, re.DOTALL)
        if not match:
            return None
        try:
            return json.loads(match.group(0))
        except json.JSONDecodeError:
            return None


async def assess_local_risk(clause_text: str) -> Dict[str, Any]:
    """Process a sensitive clause through the NVIDIA NIM / Nemotron risk agent.

    Without a configured ``NVIDIA_API_KEY`` (or with ``NIM_MOCK=true``) this runs
    a deterministic local heuristic so the pipeline is fully runnable offline.
    Otherwise it calls the OpenAI-compatible NIM endpoint (NVIDIA hosted API by
    default, or a self-hosted container via ``NIM_BASE_URL``) and parses a
    structured severity + flagged-terms verdict.
    """
    settings = get_settings()

    if not nim_is_live():
        logger.info("NIM running in local mock mode")
        return _mock_nim_assessment(clause_text)

    base = settings.nim_base_url.rstrip("/")
    on_prem = ("localhost" in base) or ("127.0.0.1" in base)
    payload = {
        "model": settings.nim_model,
        "messages": [
            {"role": "system", "content": _NIM_SYSTEM},
            {"role": "user", "content": clause_text},
        ],
        "temperature": 0.2,
        "max_tokens": 512,
    }
    headers = {"Authorization": f"Bearer {settings.nvidia_api_key}"}

    try:
        async with httpx.AsyncClient(timeout=_NIM_TIMEOUT) as client:
            resp = await client.post(
                f"{base}/chat/completions", json=payload, headers=headers
            )
            resp.raise_for_status()
            data = resp.json()

        msg = data.get("choices", [{}])[0].get("message", {}) or {}
        # Reasoning models may leave `content` empty and put the answer (with the
        # JSON) in `reasoning_content`; check both.
        content = msg.get("content") or msg.get("reasoning_content") or ""
        parsed = _parse_nim_json(content)
        if not parsed:
            raise ValueError("NIM returned no parseable JSON verdict")

        severity = str(parsed.get("severity", "MEDIUM")).upper()
        if severity not in ("LOW", "MEDIUM", "HIGH"):
            severity = "MEDIUM"
        flagged = [str(t) for t in (parsed.get("flagged_terms") or []) if t]

        logger.info("NIM/Nemotron live assessment received (severity=%s)", severity)
        return {
            "source": "nim",
            "mode": "live",
            "model": settings.nim_model,
            "severity": severity,
            "flagged_terms": flagged,
            "rationale": str(
                parsed.get("rationale", "NVIDIA Nemotron risk assessment.")
            ),
            "processed_locally": on_prem,
        }

    except Exception as exc:  # noqa: BLE001 — defensive: degrade gracefully
        logger.exception("NIM live assessment failed; falling back to local mock")
        fallback = _mock_nim_assessment(clause_text)
        fallback["error"] = str(exc)
        fallback["mode"] = "mock-fallback"
        return fallback
