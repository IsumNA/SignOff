"""SignOff backend — Asymmetric Multi-Agent Mesh (Google ADK).

Orchestrated with the **Google Agent Development Kit (ADK)**. A ``SequentialAgent``
runs two stages:

  1. ``ParallelAgent`` — fans out the asymmetric agents concurrently:
       • Risk agent       — NVIDIA Nemotron on-prem high-security clause assessment
       • Precedent agent  — Neo4j GraphRAG precedent/citation context
       • Precedent agent  — EU Publications Office authoritative legislation
       • Precedent agent  — Perplexity live, web-grounded external research
  2. ``SynthAgent``     — fuses the signals inside **Gemini 2.5 Flash** (strict JSON).

The whole graph executes via an ADK ``InMemoryRunner``. The agents wrap the
proven tool calls, so behaviour (traces, tiers, evidence) is unchanged; ADK now
owns the execution graph. If the ADK runtime ever errs, the mesh transparently
falls back to direct asyncio execution so a review can never break on stage.

The fused result is the structure the SignOff frontend consumes: a classification
(Tier 1/2/3), the per-agent reasoning trace, supporting evidence, and tool-call
traces.

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
_SYNTH_TIMEOUT_S = 40.0


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

    # Trim the grounding payloads before handing them to Gemini. The live tools
    # (esp. Perplexity) can return large blobs; an oversized prompt slows the
    # synthesis enough to trip its timeout. Trimming keeps the call fast and live
    # without changing what the tools return to the frontend.
    web_compact = {
        "source": web.get("source"),
        "analysis": (web.get("analysis") or "")[:1200],
        "citations": (web.get("citations") or [])[:5],
    }
    eu_compact = {
        "source": eu.get("source"),
        "results": (eu.get("results") or [])[:3],
    }

    prompt = (
        f"JURISDICTION: {jurisdiction}\n\n"
        f"CLAUSE UNDER REVIEW:\n{clause_text}\n\n"
        f"=== NIM_LOCAL_ASSESSMENT ===\n{json.dumps(nim, ensure_ascii=False)}\n\n"
        f"=== GRAPH_PRECEDENTS ===\n{json.dumps(graph, ensure_ascii=False)}\n\n"
        f"=== EU_LEGISLATION (live, authoritative) ===\n{json.dumps(eu_compact, ensure_ascii=False)}\n\n"
        f"=== WEB_RESEARCH ===\n{json.dumps(web_compact, ensure_ascii=False)}\n\n"
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
# Shared work units — used by both the ADK agents and the direct fallback
# ---------------------------------------------------------------------------
# Per-tool metadata: (agent label, tool name for traces, human detail).
_TOOL_SPECS: Dict[str, Tuple[str, str, str]] = {
    "nim": ("Risk Agent", "nvidia_nim_infer", "Confidential risk review of the clause text."),
    "graph": ("Precedent Agent", "query_neo4j_graph", "Precedent and citation search."),
    "eu": (
        "Precedent Agent",
        "query_eu_cellar_api",
        "Live EU legislation check (EU Publications Office).",
    ),
    "web": ("Precedent Agent", "query_perplexity_research", "Live legal research."),
}
_TOOL_ORDER: Tuple[str, ...] = ("nim", "graph", "eu", "web")


def _tool_mode(which: str) -> str:
    return {
        "nim": "live" if nim_is_live() else "demo",
        "graph": "live" if neo4j_is_live() else "demo",
        "eu": "live",  # public EU Publications Office — no key, genuinely live
        "web": "live" if perplexity_is_live() else "demo",
    }[which]


def _tool_coro(which: str, store: Dict[str, Any]) -> Awaitable[Dict[str, Any]]:
    clause = store["clause_text"]
    return {
        "nim": lambda: assess_local_risk(clause),
        "graph": lambda: query_precedents(store["effective_type"]),
        "eu": lambda: search_eu_legislation(clause),
        "web": lambda: research_clause(clause, store["jurisdiction"]),
    }[which]()


async def _do_tool(store: Dict[str, Any], which: str) -> None:
    """Run one asymmetric tool and stash its result + trace in the run store."""
    agent_label, tool_name, detail = _TOOL_SPECS[which]
    result, trace = await _run_tool(
        store["sse_id"], agent_label, tool_name, _tool_mode(which), _tool_coro(which, store), detail
    )
    store[which] = result
    store["trace_" + which] = trace


async def _do_synth(store: Dict[str, Any]) -> None:
    """Fuse the fan-out signals into the final risk verdict (Gemini, then demo)."""
    session_id = store["sse_id"]
    clause_text = store["clause_text"]
    jurisdiction = store["jurisdiction"]
    nim, graph, web, eu = store["nim"], store["graph"], store["web"], store["eu"]

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

    demo = not vertex_is_live() or synth_status == "failed"
    store["synth_result"] = synthesized
    store["trace_synth"] = synth_trace
    store["evidence"] = _build_evidence(graph, web, eu, demo, store["effective_type"])


# ---------------------------------------------------------------------------
# Google ADK orchestration layer
# ---------------------------------------------------------------------------
# Custom ADK agents share their per-run data through this registry (keyed by a
# unique run id) rather than pydantic-validated fields, so the shared dict is
# never copied by the model layer.
_RUN_STORES: Dict[str, Dict[str, Any]] = {}
_ADK_APP = "signoff"
_ADK_USER = "supervisor"


def _build_adk_imports():
    """Import ADK lazily so a missing/broken install degrades to direct mode."""
    from google.adk.agents import BaseAgent, ParallelAgent, SequentialAgent
    from google.adk.events import Event
    from google.adk.runners import InMemoryRunner
    from google.genai import types as genai_types

    class _ToolAgent(BaseAgent):
        """ADK agent that runs one asymmetric tool into the shared run store."""

        which: str
        run_key: str

        async def _run_async_impl(self, ctx):  # type: ignore[override]
            await _do_tool(_RUN_STORES[self.run_key], self.which)
            yield Event(author=self.name, invocation_id=ctx.invocation_id)

    class _SynthAgent(BaseAgent):
        """ADK agent that fuses the fan-out into the final verdict."""

        run_key: str

        async def _run_async_impl(self, ctx):  # type: ignore[override]
            await _do_synth(_RUN_STORES[self.run_key])
            yield Event(author=self.name, invocation_id=ctx.invocation_id)

    return _ToolAgent, _SynthAgent, ParallelAgent, SequentialAgent, InMemoryRunner, genai_types


async def _run_via_adk(store: Dict[str, Any], run_key: str) -> None:
    """Execute the mesh through Google ADK (ParallelAgent ▸ SynthAgent)."""
    (
        _ToolAgent,
        _SynthAgent,
        ParallelAgent,
        SequentialAgent,
        InMemoryRunner,
        genai_types,
    ) = _build_adk_imports()

    fan_out = ParallelAgent(
        name="asymmetric_fan_out",
        sub_agents=[
            _ToolAgent(name=f"{which}_agent", which=which, run_key=run_key)
            for which in _TOOL_ORDER
        ],
    )
    synth = _SynthAgent(name="synthesis_agent", run_key=run_key)
    root = SequentialAgent(name="signoff_mesh", sub_agents=[fan_out, synth])

    runner = InMemoryRunner(agent=root, app_name=_ADK_APP)
    session_id = store["sse_id"]
    await runner.session_service.create_session(
        app_name=_ADK_APP, user_id=_ADK_USER, session_id=session_id, state={}
    )
    message = genai_types.Content(
        role="user", parts=[genai_types.Part(text=store["clause_text"])]
    )
    async for _ in runner.run_async(
        user_id=_ADK_USER, session_id=session_id, new_message=message
    ):
        pass


async def _run_direct(store: Dict[str, Any]) -> None:
    """Fallback: run the same work units directly with asyncio (no ADK)."""
    await asyncio.gather(*[_do_tool(store, which) for which in _TOOL_ORDER])
    await _do_synth(store)


# ---------------------------------------------------------------------------
# Public entrypoint
# ---------------------------------------------------------------------------
async def run_mesh(
    message: str, session_id: str, jurisdiction: str = "EU", clause_type: str = ""
) -> Dict[str, Any]:
    """Run the full asymmetric mesh and return a frontend-shaped ChatResponse.

    Orchestrated by Google ADK (``SequentialAgent`` of a ``ParallelAgent`` and a
    synthesis agent). Always returns a valid structure: live signals where
    credentials exist, deterministic demo synthesis otherwise. Individual tool
    failures degrade gracefully and are surfaced in ``traces``. If the ADK
    runtime itself fails, the run falls back to direct execution.
    """
    run_key = str(uuid.uuid4())
    store: Dict[str, Any] = {
        "clause_text": message,
        "effective_type": clause_type or message[:80],
        "jurisdiction": jurisdiction,
        "sse_id": session_id,
    }
    _RUN_STORES[run_key] = store

    logger.info("Mesh run start (session=%s, jurisdiction=%s)", session_id, jurisdiction)

    try:
        try:
            await _run_via_adk(store, run_key)
            logger.info("Mesh orchestrated via Google ADK (session=%s)", session_id)
        except Exception:  # noqa: BLE001 — ADK runtime issue → never break a review
            logger.exception("ADK orchestration failed; using direct execution")
            # Re-run any units the ADK attempt didn't complete.
            if not all(w in store for w in _TOOL_ORDER) or "synth_result" not in store:
                await _run_direct(store)

        traces = [
            store[f"trace_{w}"] for w in _TOOL_ORDER if f"trace_{w}" in store
        ]
        if "trace_synth" in store:
            traces.append(store["trace_synth"])

        synthesized = store["synth_result"]
        return {
            "session_id": session_id,
            "answer": synthesized.get("answer", ""),
            "classification": synthesized["classification"],
            "agents": synthesized["agents"],
            "evidence": store.get("evidence", []),
            "traces": traces,
            "created_at": _now(),
        }
    finally:
        # Close out the live stream for any attached SSE subscribers + cleanup.
        events.mark_done(session_id)
        _RUN_STORES.pop(run_key, None)
