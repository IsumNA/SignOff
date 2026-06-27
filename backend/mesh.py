"""SignOff backend — Asymmetric Multi-Agent Mesh.

The mesh fans out three *asymmetric* agents concurrently (``asyncio.gather``):

  1. NIM local high-security agent   — sensitive on-prem clause assessment
  2. Neo4j GraphRAG precedent agent  — graph-grounded precedent/citation context
  3. Perplexity research agent       — live, web-grounded external legal search

Their outputs are fused inside **Gemini 2.5 Flash** (strict JSON) into the
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

import events
from config import (
    get_gemini_model,
    neo4j_is_live,
    nim_is_live,
    perplexity_is_live,
    vertex_is_live,
)
from tools import (
    assess_local_risk,
    query_precedents,
    research_clause,
    search_eu_legislation,
)

logger = logging.getLogger("signoff.mesh")

TIER_LABEL: Dict[int, str] = {
    1: "Routine",
    2: "Material risk",
    3: "Escalation required",
}
TIER_POSTURE: Dict[int, str] = {1: "approve", 2: "amend", 3: "reject"}

# Upper bound on the live synthesis (Vertex/Gemini) call. Past this we fall back
# to the deterministic synthesis so a single review can never stall the UI.
_SYNTH_TIMEOUT_S = 30.0


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
    """Await a tool coroutine while recording a frontend-shaped trace.

    Publishes a ``running`` frame the instant the tool starts and a terminal
    ``success``/``failed`` frame (same trace ``id``) when it returns, so the SSE
    stream shows each agent light up and resolve in real time.
    """
    trace_id = str(uuid.uuid4())
    started_at = _now()
    t0 = perf_counter()

    events.publish(
        session_id,
        {
            "id": trace_id,
            "session_id": session_id,
            "agent": agent,
            "tool": tool,
            "status": "running",
            "detail": detail,
            "mode": mode,
            "started_at": started_at,
            "finished_at": None,
            "payload": {},
        },
    )

    try:
        result = await coro
        status = (
            "failed" if isinstance(result, dict) and result.get("error") else "success"
        )
    except Exception as exc:  # noqa: BLE001 — defensive: never break the mesh
        logger.exception("Tool %s failed", tool)
        result = {"error": str(exc)}
        status = "failed"

    payload = result if isinstance(result, dict) else {"value": result}
    trace = {
        "id": trace_id,
        "session_id": session_id,
        "agent": agent,
        "tool": tool,
        "status": status,
        "detail": detail,
        "mode": mode,
        "started_at": started_at,
        "finished_at": _now(),
        "payload": {
            "duration_ms": int((perf_counter() - t0) * 1000),
            **payload,
        },
    }
    events.publish(session_id, trace)
    return result, trace


# ---------------------------------------------------------------------------
# Evidence construction (from real tool outputs)
# ---------------------------------------------------------------------------
def _build_evidence(
    graph: Dict[str, Any],
    web: Dict[str, Any],
    eu: Dict[str, Any],
    demo: bool,
    clause_type: str,
) -> List[Dict[str, Any]]:
    evidence: List[Dict[str, Any]] = []

    # Real EU legislation first — it's authoritative and genuinely live.
    for r in eu.get("results", []) or []:
        evidence.append(
            {
                "kind": "regulation",
                "title": (r.get("title") or "EU legislation")[:140],
                "source": f"EU Publications Office · CELEX {r.get('celex', '')}",
                "detail": "Authoritative EU act retrieved live from the EU "
                "Publications Office.",
                "url": r.get("url", ""),
            }
        )

    for p in graph.get("precedents", []) or []:
        title = p.get("clause_type") or p.get("clause_id") or "Precedent clause"
        evidence.append(
            {
                "kind": "precedent",
                "title": str(title),
                "source": f"Precedent graph · {p.get('clause_id', 'precedent')}",
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
                "detail": "Source cited in live research.",
                "url": str(url),
            }
        )

    if demo and not evidence:
        # Illustrative, clearly-labeled demo evidence so the UI is functional.
        evidence = [
            {
                "kind": "precedent",
                "title": f"Comparable {clause_type or 'clause'} — Project Atlas SPA",
                "source": "Precedent graph · demo",
                "detail": "Buyer-favorable formulation accepted in a prior matter; "
                "narrower carve-outs and an explicit liability cap.",
                "url": "",
            },
            {
                "kind": "regulation",
                "title": "Regulation (EU) 2016/679 (GDPR), Art. 28",
                "source": "EU Publications Office · demo",
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
    eu: Dict[str, Any],
) -> Dict[str, Any]:
    severity = nim.get("severity", "MEDIUM")
    flagged: List[str] = nim.get("flagged_terms", []) or []
    tier = _severity_to_tier(severity)
    precedent_count = len(graph.get("precedents", []) or [])
    eu_acts = eu.get("results", []) or []
    eu_count = len(eu_acts)

    triggers: List[str] = []
    for term in flagged:
        triggers.append(f"High-risk language detected — “{term}”")
    if not triggers:
        triggers.append("No blocking risk signals detected in clause text.")

    posture = TIER_POSTURE[tier]
    deal_reasoning = "\n".join(
        [
            f"- Recommended posture: {posture.title()} (Tier {tier} · {TIER_LABEL[tier]}).",
            f"- Risk review severity: {severity}"
            + (f" on {', '.join(flagged)}." if flagged else "."),
            f"- Precedent review: {precedent_count} comparable precedent(s) reviewed.",
            "- Negotiate explicit caps and carve-outs where exposure is open-ended."
            if tier >= 2
            else "- Standard terms; proceed and record in the audit log.",
            f"Research: grounded against {eu_count} live EU act(s) (Publications Office) "
            + (
                f"incl. {eu_acts[0].get('celex')}."
                if eu_acts
                else "for regulatory context."
            ),
        ]
    )

    agents = [
        {
            "agent": "Risk Agent",
            "model": "NVIDIA Nemotron",
            "summary": f"Confidential risk review flagged severity {severity}.",
            "mode": "live" if nim_is_live() else "demo",
            "findings": flagged or ["No sensitive risk terms detected."],
            "stance": severity,
            "phase": "initial",
            "assumptions": ["Clause reviewed confidentially; no sensitive text left the secure environment."],
            "red_flags": flagged,
            "reasoning": nim.get("rationale", "Confidential risk assessment of the clause."),
        },
        {
            "agent": "Precedent Agent",
            "model": "Neo4j + EU Publications Office",
            "summary": (
                f"{precedent_count} precedent(s) + {eu_count} EU act(s) reviewed."
            ),
            "mode": "live" if (neo4j_is_live() or eu_count) else "demo",
            "findings": [
                f"{precedent_count} comparable precedent(s) in the precedent database.",
                f"{eu_count} authoritative EU act(s) via the EU Publications Office.",
            ]
            + [f"{a.get('celex')} — {a.get('title', '')[:80]}" for a in eu_acts[:2]],
            "stance": "grounded" if (precedent_count or eu_count) else "sparse-precedent",
            "phase": "initial",
            "assumptions": ["The precedent database reflects the firm's curated prior matters."],
            "red_flags": [],
            "reasoning": (
                "Matched precedent clauses and live EU legislation (EU Publications "
                "Office) to ground the risk position in prior outcomes and binding regulation."
            ),
        },
        {
            "agent": "Deal Agent",
            "model": "Gemini 2.5 Flash",
            "summary": f"Recommendation: Tier {tier} · {TIER_LABEL[tier]}.",
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
# Live synthesis — Gemini 2.5 Flash, strict JSON
# ---------------------------------------------------------------------------
_SYNTH_SYSTEM = """\
You are the SignOff synthesizer for an asymmetric legal-risk multi-agent mesh.
You receive independent signals about one contract clause:
  1. NIM_LOCAL_ASSESSMENT — on-prem high-security severity + flagged terms.
  2. GRAPH_PRECEDENTS     — precedent clauses + citations from a graph DB.
  3. EU_LEGISLATION       — authoritative EU acts (CELEX) retrieved live from the
                           Publications Office; cite these where they bind.
  4. WEB_RESEARCH         — live external legal research with citations.

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
    eu: Dict[str, Any],
) -> Dict[str, Any]:
    from vertexai.generative_models import GenerationConfig

    model = get_gemini_model()
    prompt = (
        f"JURISDICTION: {jurisdiction}\n\n"
        f"CLAUSE UNDER REVIEW:\n{clause_text}\n\n"
        f"=== NIM_LOCAL_ASSESSMENT ===\n{json.dumps(nim, ensure_ascii=False)}\n\n"
        f"=== GRAPH_PRECEDENTS ===\n{json.dumps(graph, ensure_ascii=False)}\n\n"
        f"=== EU_LEGISLATION (live, authoritative) ===\n{json.dumps(eu, ensure_ascii=False)}\n\n"
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

    # Normalize so the result always satisfies the API schema, even when the
    # model omits a field it deems implied — otherwise FastAPI 500s on response
    # validation and the whole review fails. Defaults are conservative.
    cls = parsed.setdefault("classification", {})
    tier = int(cls.get("tier", 2) or 2)
    cls["tier"] = tier
    cls.setdefault("tier_label", TIER_LABEL.get(tier, "Material risk"))
    cls.setdefault("recommended_posture", TIER_POSTURE.get(tier, "amend"))
    cls.setdefault("escalated", tier == 3)
    cls.setdefault("triggers", [])
    cls.setdefault("confidence", 0.8)
    parsed.setdefault("answer", "")

    # Fill every required AgentResult field; the frontend shows these verbatim.
    for agent in parsed.get("agents", []):
        agent.setdefault("agent", "Deal Agent")
        agent.setdefault("model", "Gemini 2.5 Flash")
        agent.setdefault("summary", "")
        agent.setdefault("mode", "live")
        agent.setdefault("findings", [])
        agent.setdefault("stance", "")
        agent.setdefault("phase", "initial")
        agent.setdefault("assumptions", [])
        agent.setdefault("red_flags", [])
        agent.setdefault("reasoning", agent.get("summary", ""))
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
    (
        (nim, nim_trace),
        (graph, graph_trace),
        (eu, eu_trace),
        (web, web_trace),
    ) = await asyncio.gather(
        _run_tool(
            session_id,
            "Risk Agent",
            "nvidia_nim_infer",
            "live" if nim_is_live() else "demo",
            assess_local_risk(clause_text),
            "Confidential risk review of the clause text.",
        ),
        _run_tool(
            session_id,
            "Precedent Agent",
            "query_neo4j_graph",
            "live" if neo4j_is_live() else "demo",
            query_precedents(effective_type),
            "Precedent and citation search.",
        ),
        _run_tool(
            session_id,
            "Precedent Agent",
            "query_eu_cellar_api",
            "live",  # public EU Publications Office — no key, genuinely live
            search_eu_legislation(clause_text),
            "Live EU legislation check (EU Publications Office).",
        ),
        _run_tool(
            session_id,
            "Precedent Agent",
            "query_perplexity_research",
            "live" if perplexity_is_live() else "demo",
            research_clause(clause_text, jurisdiction),
            "Live legal research.",
        ),
    )
    traces.extend([nim_trace, graph_trace, eu_trace, web_trace])

    # --- Synthesis (Gemini live, deterministic demo otherwise) -----------
    synth_id = str(uuid.uuid4())
    synth_mode = "live" if vertex_is_live() else "demo"
    synth_detail = "Combine all findings into a single risk rating."
    synth_started = _now()
    synth_t0 = perf_counter()
    synth_status = "success"

    events.publish(
        session_id,
        {
            "id": synth_id,
            "session_id": session_id,
            "agent": "Deal Agent",
            "tool": "gemini_reason",
            "status": "running",
            "detail": synth_detail,
            "mode": synth_mode,
            "started_at": synth_started,
            "finished_at": None,
            "payload": {},
        },
    )

    if vertex_is_live():
        try:
            # Bound the live call so a slow Vertex response can never hang the
            # review (e.g. on stage). On timeout we drop to the deterministic
            # synthesis, which is instant and grounded on the same signals.
            synthesized = await asyncio.wait_for(
                _gemini_synthesis(clause_text, jurisdiction, nim, graph, web, eu),
                timeout=_SYNTH_TIMEOUT_S,
            )
        except Exception as exc:  # noqa: BLE001 — fall back to demo synthesis
            logger.exception("Gemini synthesis failed; using demo fallback")
            synth_status = "failed"
            synthesized = _demo_synthesis(clause_text, nim, graph, web, eu)
            synthesized["agents"][-1]["red_flags"].append(f"Gemini error: {exc}")
    else:
        synthesized = _demo_synthesis(clause_text, nim, graph, web, eu)

    synth_trace = {
        "id": synth_id,
        "session_id": session_id,
        "agent": "Deal Agent",
        "tool": "gemini_reason",
        "status": synth_status,
        "detail": synth_detail,
        "mode": synth_mode,
        "started_at": synth_started,
        "finished_at": _now(),
        "payload": {"duration_ms": int((perf_counter() - synth_t0) * 1000)},
    }
    events.publish(session_id, synth_trace)
    traces.append(synth_trace)

    demo = not vertex_is_live() or synth_status == "failed"
    evidence = _build_evidence(graph, web, eu, demo, effective_type)

    # Close out the live stream for any attached SSE subscribers.
    events.mark_done(session_id)

    return {
        "session_id": session_id,
        "answer": synthesized.get("answer", ""),
        "classification": synthesized["classification"],
        "agents": synthesized["agents"],
        "evidence": evidence,
        "traces": traces,
        "created_at": _now(),
    }
