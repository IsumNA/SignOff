"""SignOff backend — Asymmetric Multi-Agent Mesh.

The mesh fans out three *asymmetric* agents concurrently (``asyncio.gather``):

  1. NIM local high-security agent   — sensitive on-prem clause assessment
  2. Neo4j GraphRAG precedent agent  — graph-grounded precedent/citation context
  3. Perplexity research agent       — live, web-grounded external legal search

Their outputs are then fused inside the **Gemini 1.5 Pro** synthesizer, which
emits a strict-JSON risk mitigation verdict (Tier 1 / Tier 2 / Tier 3).

"Asymmetric" here means the agents differ in trust boundary, latency and data
sensitivity: the NIM agent runs locally on sensitive text, while the graph and
web agents enrich with external, non-sensitive grounding.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict

from config import get_gemini_model
from tools import assess_local_risk, query_precedents, research_clause

logger = logging.getLogger("signoff.mesh")


# Risk Tiers (asymmetric mitigation posture):
#   Tier 1 — Critical: blocking risk, requires legal sign-off / renegotiation.
#   Tier 2 — Elevated: negotiate fallback language, add safeguards.
#   Tier 3 — Standard: acceptable, minor or boilerplate concerns.
_SYNTHESIZER_SYSTEM = """\
You are the SignOff synthesizer — the final arbiter of an asymmetric legal
risk multi-agent mesh. You receive three independent signals about a single
contract clause:

  1. NIM_LOCAL_ASSESSMENT  — high-security on-prem severity + flagged terms.
  2. GRAPH_PRECEDENTS      — precedent clauses and citations from a graph DB.
  3. WEB_RESEARCH          — live external legal research with citations.

Weigh these signals, resolve disagreements conservatively (favor the higher
risk when sources conflict), and assign exactly one mitigation tier:

  - "Tier 1": Critical — blocking risk; requires legal sign-off / renegotiation.
  - "Tier 2": Elevated — negotiate fallback language; add explicit safeguards.
  - "Tier 3": Standard — acceptable; minor or boilerplate concerns only.

Respond with a SINGLE JSON object and nothing else, matching this schema:
{
  "risk_tier": "Tier 1" | "Tier 2" | "Tier 3",
  "confidence": number,                // 0.0 - 1.0
  "summary": string,                   // one-paragraph executive summary
  "key_risks": string[],               // concrete risks identified
  "recommended_mitigations": string[], // actionable redline guidance
  "citations": string[],               // statutes/cases/URLs grounding the call
  "agent_signals": {
    "nim_severity": string,
    "precedent_count": number,
    "web_grounded": boolean
  }
}
"""


def _build_synthesis_prompt(
    clause_text: str,
    jurisdiction: str,
    nim: Dict[str, Any],
    graph: Dict[str, Any],
    web: Dict[str, Any],
) -> str:
    """Assemble the user prompt fusing all three agent signals."""
    return (
        f"JURISDICTION: {jurisdiction}\n\n"
        f"CLAUSE UNDER REVIEW:\n{clause_text}\n\n"
        "=== NIM_LOCAL_ASSESSMENT ===\n"
        f"{json.dumps(nim, ensure_ascii=False, indent=2)}\n\n"
        "=== GRAPH_PRECEDENTS ===\n"
        f"{json.dumps(graph, ensure_ascii=False, indent=2)}\n\n"
        "=== WEB_RESEARCH ===\n"
        f"{json.dumps(web, ensure_ascii=False, indent=2)}\n\n"
        "Produce the risk mitigation JSON verdict now."
    )


async def _synthesize_with_gemini(prompt: str) -> Dict[str, Any]:
    """Call Gemini 1.5 Pro in strict-JSON mode and parse the verdict."""
    from vertexai.generative_models import GenerationConfig

    model = get_gemini_model()

    # Strict JSON output mode — Gemini is constrained to emit valid JSON only.
    generation_config = GenerationConfig(
        response_mime_type="application/json",
        temperature=0.2,
    )

    response = await model.generate_content_async(
        [_SYNTHESIZER_SYSTEM, prompt],
        generation_config=generation_config,
    )

    raw = (response.text or "").strip()
    return json.loads(raw)


async def analyze_clause(
    clause_text: str,
    jurisdiction: str = "EU",
    clause_type: str = "",
) -> Dict[str, Any]:
    """Run the full asymmetric mesh for a single clause.

    Steps:
      1. Fan out NIM, Neo4j and Perplexity agents concurrently.
      2. Fuse their signals inside Gemini 1.5 Pro (strict JSON).
      3. Return a structured risk-mitigation verdict.

    Raises on unrecoverable synthesis failure; individual tool failures are
    absorbed by the tools themselves and surfaced as ``error`` keys.
    """
    effective_type = clause_type or clause_text[:80]

    logger.info(
        "Mesh fan-out start (jurisdiction=%s, clause_type=%r)",
        jurisdiction,
        effective_type,
    )

    # --- Parallel asymmetric fan-out -------------------------------------
    nim_result, graph_result, web_result = await asyncio.gather(
        assess_local_risk(clause_text),
        query_precedents(effective_type),
        research_clause(clause_text, jurisdiction),
    )

    logger.info(
        "Mesh fan-out complete (nim=%s, precedents=%d, web_citations=%d)",
        nim_result.get("severity") or nim_result.get("mode"),
        len(graph_result.get("precedents", [])),
        len(web_result.get("citations", [])),
    )

    # --- Synthesis with Gemini 1.5 Pro -----------------------------------
    prompt = _build_synthesis_prompt(
        clause_text, jurisdiction, nim_result, graph_result, web_result
    )

    try:
        verdict = await _synthesize_with_gemini(prompt)
    except json.JSONDecodeError as exc:
        logger.exception("Gemini returned non-JSON output")
        raise ValueError(f"Synthesizer produced invalid JSON: {exc}") from exc

    # Attach raw agent signals for auditability / traceability.
    verdict["_raw_signals"] = {
        "nim": nim_result,
        "graph": graph_result,
        "web": web_result,
    }
    return verdict
