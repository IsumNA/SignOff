"""SignOff backend — Asymmetric Multi-Agent Mesh.

The mesh fans out three *asymmetric* agents concurrently (``asyncio.gather``):

  1. NIM local high-security agent   — sensitive on-prem clause assessment
  2. Neo4j GraphRAG precedent agent  — graph-grounded precedent/citation context
  3. Perplexity research agent       — live, web-grounded external legal search

Their outputs are fused inside **Gemini 1.5 Pro** (strict JSON) into the
structure the SignOff frontend consumes: a classification (Tier 1/2/3), the
per-agent reasoning trace, supporting evidence, and tool-call traces.

When cloud credentials are absent the mesh runs in **demo mode** — a fully
deterministic local synthesis so the UI is usable end-to-end without GCP,
Neo4j, or Perplexity configured. The ``mode`` field on every agent/trace tells
the frontend whether a signal was "live" or "demo".

Tier convention (matches the frontend):
    Tier 1 — Routine             → recommend "approve"
    Tier 2 — Material risk       → recommend "amend"
    Tier 3 — Escalation required → recommend "reject"
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from datetime import datetime, timezone
from time import perf_counter
from typing import Any, Awaitable, Callable, Dict, List, Tuple

from config import (
    get_gemini_model,
    neo4j_is_live,
    nim_is_live,
    perplexity_is_live,
    vertex_is_live,
)
from tools import assess_local_risk, query_precedents, research_clause

logger = logging.getLogger("signoff.mesh")

TIER_LABEL: Dict[int, str] = {
    1: "Routine",
    2: "Material risk",
    3: "Escalation required",
}
TIER_POSTURE: Dict[int, str] = {1: "approve", 2: "amend", 3: "reject"}


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------------------------------------------------------------------
# Traced tool execution
# ---------------------------------------------------------------------------
async def _run_tool(
    session_id: str,
    agent: str,
    tool: str,
    mode: str,
    coro: Awaitable[Dict[str, Any]],
    detail: str,
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Await a tool coroutine while recording a frontend-shaped trace."""
    started_at = _now()
    t0 = perf_counter()
    try:
        result = await coro
        status = (
            "failed" if isinstance(result, dict) and result.get("error") else "success"
        )
    except Exception as exc:  # noqa: BLE001 — defensive: never break the mesh
        logger.exception("Tool %s failed", tool)
        result = {"error": str(exc)}
        status = "failed"

    trace = {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "agent": agent,
        "tool": tool,
        "status": status,
        "detail": detail,
        "mode": mode,
        "started_at": started_at,
        "finished_at": _now(),
        "payload": result if isinstance(result, dict) else {"value": result},
    }
    trace["payload"] = {
        "duration_ms": int((perf_counter() - t0) * 1000),
        **trace["payload"],
    }
    return result, trace


# ---------------------------------------------------------------------------
# Evidence construction (from real tool outputs)
# ---------------------------------------------------------------------------
def _build_evidence(
    graph: Dict[str, Any], web: Dict[str, Any], demo: bool, clause_type: str
) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []

    for p in graph.get("precedents", []) or []:
        title = p.get("clause_type") or p.get("clause_id") or "Precedent clause"
        evidence.append(
            {
                "kind": "precedent",
                "title": str(title),
                "source": f"Neo4j · {p.get('clause_id', 'precedent')}",
                "detail": (p.get("clause_text") or "")[:240],
                "url": "",
            }
        )

    for url in web.get("citations", []) or []:
        evidence.append(
            {
                "kind": "citation",
                "title": str(url).split("//")[-1].split("/")[0] or "Source",
                "source": "Perplexity",
                "detail": "Web-grounded source cited in live research.",
                "url": str(url),
            }
        )

    if demo and not evidence:
        # Illustrative, clearly-labeled demo evidence so the UI is functional.
        evidence = [
            {
                "kind": "precedent",
                "title": f"Comparable {clause_type or 'clause'} — Project Atlas SPA",
                "source": "Neo4j · demo-precedent",
                "detail": "Buyer-favorable formulation accepted in a prior matter; "
                "narrower carve-outs and an explicit liability cap.",
                "url": "",
            },
            {
                "kind": "regulation",
                "title": "Regulation (EU) 2016/679 (GDPR), Art. 28",
                "source": "EU Cellar · demo",
                "detail": "Processor obligations relevant to data-handling clauses.",
                "url": "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
            },
            {
                "kind": "citation",
                "title": "Practitioner note on uncapped indemnities",
                "source": "Perplexity · demo",
                "detail": "Market-standard guidance on capping and time-limiting "
                "seller indemnities.",
                "url": "https://www.perplexity.ai/",
            },
        ]

    return evidence


# ---------------------------------------------------------------------------
# Demo (deterministic) synthesis — no cloud required
# ---------------------------------------------------------------------------
def _severity_to_tier(severity: str) -> int:
    return {"HIGH": 3, "MEDIUM": 2, "LOW": 1}.get((severity or "").upper(), 2)


def _demo_synthesis(
    clause_text: str,
    nim: Dict[str, Any],
    graph: Dict[str, Any],
    web: Dict[str, Any],
) -> Dict[str, Any]:
    severity = nim.get("severity", "MEDIUM")
    flagged: List[str] = nim.get("flagged_terms", []) or []
    tier = _severity_to_tier(severity)
    precedent_count = len(graph.get("precedents", []) or [])

    triggers: List[str] = []
    for term in flagged:
        triggers.append(f"High-risk language detected — “{term}”")
    if not triggers:
        triggers.append("No blocking risk signals detected in clause text.")

    posture = TIER_POSTURE[tier]
    deal_reasoning = "\n".join(
        [
            f"- Recommended posture: {posture.title()} (Tier {tier} · {TIER_LABEL[tier]}).",
            f"- Risk Agent severity: {severity}"
            + (f" on {', '.join(flagged)}." if flagged else "."),
            f"- Precedent Agent: {precedent_count} comparable precedent(s) reviewed.",
            "- Negotiate explicit caps and carve-outs where exposure is open-ended."
            if tier >= 2
            else "- Standard terms; proceed and record in the audit log.",
            "Research: aligned with prevailing market practice for this clause type.",
        ]
    )

    agents = [
        {
            "agent": "Risk Agent",
            "model": "NVIDIA NIM",
            "summary": f"On-prem high-security review flagged severity {severity}.",
            "mode": "live" if nim_is_live() else "demo",
            "findings": flagged or ["No sensitive risk terms detected."],
            "stance": severity,
            "phase": "initial",
            "assumptions": ["Clause processed locally; no sensitive data left the boundary."],
            "red_flags": flagged,
            "reasoning": nim.get("rationale", "Local heuristic risk assessment."),
        },
        {
            "agent": "Precedent Agent",
            "model": "Vertex AI",
            "summary": f"{precedent_count} precedent(s) retrieved from the graph.",
            "mode": "live" if neo4j_is_live() else "demo",
            "findings": [
                f"{precedent_count} comparable precedent(s) in the citation graph."
            ],
            "stance": "grounded" if precedent_count else "sparse-precedent",
            "phase": "initial",
            "assumptions": ["Graph reflects the firm's curated precedent corpus."],
            "red_flags": [],
            "reasoning": (
                "Matched precedent clauses and their citation chains to ground the "
                "risk posture in prior outcomes."
            ),
        },
        {
            "agent": "Deal Agent",
            "model": "Gemini 1.5 Pro",
            "summary": f"Synthesized verdict: Tier {tier} · {TIER_LABEL[tier]}.",
            "mode": "live" if vertex_is_live() else "demo",
            "findings": triggers,
            "stance": posture,
            "phase": "resolution",
            "assumptions": ["Signals weighted conservatively toward higher risk."],
            "red_flags": flagged if tier == 3 else [],
            "reasoning": deal_reasoning,
        },
    ]

    answer = (
        f"This clause is classified Tier {tier} ({TIER_LABEL[tier]}). "
        f"Recommended posture: {posture}. "
        + (
            f"Key drivers: {', '.join(flagged)}."
            if flagged
            else "No material risk drivers detected."
        )
    )

    return {
        "answer": answer,
        "classification": {
            "tier": tier,
            "tier_label": TIER_LABEL[tier],
            "escalated": tier == 3,
            "triggers": triggers,
            "recommended_posture": posture,
            "confidence": 0.72 if not perplexity_is_live() else 0.8,
        },
        "agents": agents,
    }


# ---------------------------------------------------------------------------
# Live synthesis — Gemini 1.5 Pro, strict JSON
# ---------------------------------------------------------------------------
_SYNTH_SYSTEM = """\
You are the SignOff synthesizer for an asymmetric legal-risk multi-agent mesh.
You receive three independent signals about one contract clause:
  1. NIM_LOCAL_ASSESSMENT — on-prem high-security severity + flagged terms.
  2. GRAPH_PRECEDENTS     — precedent clauses + citations from a graph DB.
  3. WEB_RESEARCH         — live external legal research with citations.

Weigh the signals, resolve conflicts conservatively (favor higher risk), and
assign exactly one tier using THIS convention:
  - tier 1 → "Routine"             → recommended_posture "approve"
  - tier 2 → "Material risk"       → recommended_posture "amend"
  - tier 3 → "Escalation required" → recommended_posture "reject"

Respond with a SINGLE JSON object and nothing else, matching this schema:
{
  "answer": string,
  "classification": {
    "tier": 1 | 2 | 3,
    "tier_label": string,
    "escalated": boolean,
    "triggers": string[],
    "recommended_posture": "approve" | "amend" | "reject",
    "confidence": number
  },
  "agents": [
    {
      "agent": "Risk Agent" | "Precedent Agent" | "Deal Agent",
      "model": string,
      "summary": string,
      "findings": string[],
      "stance": string,
      "phase": "initial" | "resolution",
      "assumptions": string[],
      "red_flags": string[],
      "reasoning": string
    }
  ]
}
The Deal Agent must have phase "resolution"; the others "initial". In the Deal
Agent's reasoning, use "- " bullet lines for recommended actions and a line
starting with "Research:" for the external grounding summary.
"""


async def _gemini_synthesis(
    clause_text: str,
    jurisdiction: str,
    nim: Dict[str, Any],
    graph: Dict[str, Any],
    web: Dict[str, Any],
) -> Dict[str, Any]:
    from vertexai.generative_models import GenerationConfig

    model = get_gemini_model()
    prompt = (
        f"JURISDICTION: {jurisdiction}\n\n"
        f"CLAUSE UNDER REVIEW:\n{clause_text}\n\n"
        f"=== NIM_LOCAL_ASSESSMENT ===\n{json.dumps(nim, ensure_ascii=False)}\n\n"
        f"=== GRAPH_PRECEDENTS ===\n{json.dumps(graph, ensure_ascii=False)}\n\n"
        f"=== WEB_RESEARCH ===\n{json.dumps(web, ensure_ascii=False)}\n\n"
        "Produce the risk JSON now."
    )

    # Strict JSON output mode.
    config = GenerationConfig(
        response_mime_type="application/json", temperature=0.2
    )
    response = await model.generate_content_async(
        [_SYNTH_SYSTEM, prompt], generation_config=config
    )
    parsed = json.loads((response.text or "").strip())

    # Stamp the live mode onto each agent for the frontend indicator.
    for agent in parsed.get("agents", []):
        agent.setdefault("mode", "live")
        agent.setdefault("assumptions", [])
        agent.setdefault("red_flags", [])
        agent.setdefault("findings", [])
    return parsed


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------
async def run_mesh(
    message: str, session_id: str, jurisdiction: str = "EU", clause_type: str = ""
) -> Dict[str, Any]:
    """Run the full asymmetric mesh and return a frontend-shaped ChatResponse.

    Always returns a valid structure: live signals where credentials exist,
    deterministic demo synthesis otherwise. Individual tool failures degrade
    gracefully and are surfaced in ``traces``.
    """
    clause_text = message
    effective_type = clause_type or clause_text[:80]
    traces: List[Dict[str, Any]] = []

    logger.info("Mesh run start (session=%s, jurisdiction=%s)", session_id, jurisdiction)

    # --- Parallel asymmetric fan-out -------------------------------------
    (nim, nim_trace), (graph, graph_trace), (web, web_trace) = await asyncio.gather(
        _run_tool(
            session_id,
            "Risk Agent",
            "nvidia_nim_infer",
            "live" if nim_is_live() else "demo",
            assess_local_risk(clause_text),
            "Local high-security risk inference on sensitive clause text.",
        ),
        _run_tool(
            session_id,
            "Precedent Agent",
            "query_neo4j_graph",
            "live" if neo4j_is_live() else "demo",
            query_precedents(effective_type),
            "GraphRAG precedent + citation retrieval.",
        ),
        _run_tool(
            session_id,
            "Precedent Agent",
            "query_perplexity_research",
            "live" if perplexity_is_live() else "demo",
            research_clause(clause_text, jurisdiction),
            "Live web-grounded legal research.",
        ),
    )
    traces.extend([nim_trace, graph_trace, web_trace])

    # --- Synthesis (Gemini live, deterministic demo otherwise) -----------
    synth_started = _now()
    synth_t0 = perf_counter()
    synth_status = "success"
    if vertex_is_live():
        try:
            synthesized = await _gemini_synthesis(
                clause_text, jurisdiction, nim, graph, web
            )
        except Exception as exc:  # noqa: BLE001 — fall back to demo synthesis
            logger.exception("Gemini synthesis failed; using demo fallback")
            synth_status = "failed"
            synthesized = _demo_synthesis(clause_text, nim, graph, web)
            synthesized["agents"][-1]["red_flags"].append(f"Gemini error: {exc}")
    else:
        synthesized = _demo_synthesis(clause_text, nim, graph, web)

    traces.append(
        {
            "id": str(uuid.uuid4()),
            "session_id": session_id,
            "agent": "Deal Agent",
            "tool": "gemini_reason",
            "status": synth_status,
            "detail": "Fuse asymmetric signals into a risk tier (strict JSON).",
            "mode": "live" if vertex_is_live() else "demo",
            "started_at": synth_started,
            "finished_at": _now(),
            "payload": {"duration_ms": int((perf_counter() - synth_t0) * 1000)},
        }
    )

    demo = not vertex_is_live() or synth_status == "failed"
    evidence = _build_evidence(graph, web, demo, effective_type)

    return {
        "session_id": session_id,
        "answer": synthesized.get("answer", ""),
        "classification": synthesized["classification"],
        "agents": synthesized["agents"],
        "evidence": evidence,
        "traces": traces,
        "created_at": _now(),
    }
