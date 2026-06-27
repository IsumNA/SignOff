"""SignOff backend — Multi-Matter Risk Ledger (demo data).

Provides the deterministic "fleet view" the partner sees on login: every active
matter, the autonomous agents deployed on it, its compliance envelope, and any
blockers pending human review.

This is demo data — self-contained and consistent with the backend's demo mode.
Agent labels here are display-only (Claude, GPT-4o, Harvey, ...); the real mesh
engine remains Gemini / NIM / Neo4j / Perplexity.
"""

from __future__ import annotations

from typing import Any, Dict, List

# Status drives the row's risk colour on the ledger:
#   review   — has Tier 3 blocker exceptions (critical)
#   warning  — has Tier 2 warnings (material)
#   escalate — junior escalation requests awaiting partner
#   passed   — all controls passed; cleared to sign
_MATTERS: List[Dict[str, Any]] = [
    {
        "id": "atlas",
        "name": "Project Atlas",
        "asset_class": "M&A",
        "deal_size": "$120M",
        "agents_deployed": ["Gemini 1.5 Pro", "Claude 3.5 Sonnet", "Local NIM"],
        "compliance_envelope": 87,
        "blockers": {"count": 2, "tier": 3, "label": "Blocker Exceptions"},
        "status": "review",
        "action": "review",
    },
    {
        "id": "titan",
        "name": "Project Titan",
        "asset_class": "Debt Financing",
        "deal_size": "$45M",
        "agents_deployed": ["GPT-4o", "Harvey"],
        "compliance_envelope": 98,
        "blockers": {"count": 1, "tier": 2, "label": "Warning"},
        "status": "warning",
        "action": "review",
    },
    {
        "id": "helios",
        "name": "Helios Energy",
        "asset_class": "Regulatory Audit",
        "deal_size": "—",
        "agents_deployed": ["Llama-3 (Local)", "Perplexity"],
        "compliance_envelope": 100,
        "blockers": {"count": 0, "tier": 0, "label": "Passed Controls"},
        "status": "passed",
        "action": "signoff",
    },
    {
        "id": "vanguard",
        "name": "Vanguard JV",
        "asset_class": "Joint Venture",
        "deal_size": "$15M",
        "agents_deployed": ["Gemini 1.5 Pro"],
        "compliance_envelope": 64,
        "blockers": {"count": 4, "tier": 2, "label": "Escalate Requests"},
        "status": "escalate",
        "action": "review",
    },
    {
        "id": "meridian",
        "name": "Meridian Logistics",
        "asset_class": "Asset Purchase",
        "deal_size": "$210M",
        "agents_deployed": ["Gemini 1.5 Pro", "Local NIM", "Perplexity"],
        "compliance_envelope": 100,
        "blockers": {"count": 0, "tier": 0, "label": "Passed Controls"},
        "status": "passed",
        "action": "signoff",
    },
]


def list_matters() -> Dict[str, Any]:
    """Return all matters plus an aggregate portfolio risk summary."""
    matters = [dict(m) for m in _MATTERS]

    total_matters = len(matters)
    total_blockers = sum(m["blockers"]["count"] for m in matters)
    avg_envelope = (
        round(sum(m["compliance_envelope"] for m in matters) / total_matters)
        if total_matters
        else 0
    )
    ready_to_sign = sum(1 for m in matters if m["action"] == "signoff")

    return {
        "matters": matters,
        "summary": {
            "total_matters": total_matters,
            "total_blockers": total_blockers,
            "avg_envelope": avg_envelope,
            "ready_to_sign": ready_to_sign,
        },
    }
