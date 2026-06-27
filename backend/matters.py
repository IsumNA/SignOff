"""SignOff backend — Multi-Matter Risk Ledger + supervision lifecycle (demo data).

Models supervision as the four-stage lifecycle the workflow is built around:

    (i) plan  →  (ii) coordinate  →  (iii) review  →  (iv) sign off

Provides:
  * :func:`list_matters`  — the fleet view (every matter + its lifecycle stage).
  * :func:`create_matter` — the Plan stage output: configure a matter + its risk
                            envelope and deploy agents onto it.
  * :func:`list_tasks`    — the Coordinate stage board: per-matter workstreams
                            flowing across the multi-agent pipeline.

This is demo data — self-contained and consistent with the backend's demo mode.
Agent labels here are display-only (Claude, GPT-4o, Harvey, ...); the real mesh
engine remains Gemini / NIM / Neo4j / Perplexity.
"""

from __future__ import annotations

from typing import Any, Dict, List

# Lifecycle stages (the supervision spine):
#   plan       — envelope defined, agents not yet dispatched
#   coordinate — agents dispatched; workstreams in flight across the mesh
#   review     — agent output ready; blockers awaiting human inspection
#   signoff    — all controls cleared; awaiting the partner's signature
LIFECYCLE_STAGES = ("plan", "coordinate", "review", "signoff")

# Coordinate-board columns — one workstream card flows left → right as the
# asymmetric mesh processes it, ending at counsel review then signature.
TASK_COLUMNS = (
    "queued",
    "risk",
    "precedent",
    "research",
    "synthesis",
    "counsel",
    "signed",
)

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
        "stage": "review",
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
        "stage": "review",
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
        "stage": "signoff",
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
        "stage": "coordinate",
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
        "stage": "signoff",
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


def get_matter(matter_id: str) -> Dict[str, Any] | None:
    """Return a single matter dict by id, or None."""
    for m in _MATTERS:
        if m["id"] == matter_id:
            return dict(m)
    return None


# ---------------------------------------------------------------------------
# (i) PLAN — define the envelope + deploy agents
# ---------------------------------------------------------------------------
def _slugify(name: str) -> str:
    base = "".join(c.lower() if c.isalnum() else "-" for c in name).strip("-")
    base = "-".join(filter(None, base.split("-"))) or "matter"
    slug = base
    n = 2
    existing = {m["id"] for m in _MATTERS}
    while slug in existing:
        slug = f"{base}-{n}"
        n += 1
    return slug


def create_matter(data: Dict[str, Any]) -> Dict[str, Any]:
    """Plan-stage output: register a new supervised matter.

    A freshly-planned matter has its risk envelope defined and agents deployed,
    but no agent output yet — so it lands in the ``coordinate`` stage with a
    clean (no-blocker) status, ready for the partner to watch the mesh work.
    """
    name = (data.get("name") or "Untitled Matter").strip()
    agents = [a for a in (data.get("agents_deployed") or []) if a] or ["Gemini 1.5 Pro"]
    envelope = int(data.get("envelope_target") or 100)
    envelope = max(0, min(100, envelope))

    matter = {
        "id": _slugify(name),
        "name": name,
        "asset_class": (data.get("asset_class") or "M&A").strip(),
        "deal_size": (data.get("deal_size") or "—").strip(),
        "agents_deployed": agents,
        "compliance_envelope": envelope,
        "blockers": {"count": 0, "tier": 0, "label": "Agents Dispatched"},
        "status": "passed",
        "stage": "coordinate",
        "action": "review",
        # Plan-stage configuration retained for the Coordinate board context.
        "jurisdiction": (data.get("jurisdiction") or "English law").strip(),
        "scope": [s for s in (data.get("scope") or []) if s],
        "redlines": [r for r in (data.get("redlines") or []) if r],
        "escalation_tier": int(data.get("escalation_tier") or 3),
    }
    _MATTERS.append(matter)
    return dict(matter)


# ---------------------------------------------------------------------------
# (ii) COORDINATE — the workstream board
# ---------------------------------------------------------------------------
# Canonical workstreams a corporate matter is decomposed into. Each becomes a
# card that flows across the mesh pipeline on the Coordinate board.
_WORKSTREAMS: List[Dict[str, str]] = [
    {"ref": "§2.1", "title": "Purchase Price & Adjustments"},
    {"ref": "§4.1", "title": "Interim Operating Covenants"},
    {"ref": "§7.3", "title": "Material Adverse Change"},
    {"ref": "§8.2", "title": "Data Protection & Processing"},
    {"ref": "§9.1", "title": "Seller Indemnification"},
    {"ref": "§11.2", "title": "Confidentiality"},
    {"ref": "§13.4", "title": "Governing Law & Jurisdiction"},
]

# Per lifecycle stage, how the 7 workstreams distribute across the board.
# Index i of the tuple = workstream i's column.
_STAGE_DISTRIBUTION: Dict[str, List[str]] = {
    "plan": ["queued", "queued", "queued", "queued", "queued", "queued", "queued"],
    "coordinate": [
        "signed",
        "synthesis",
        "research",
        "precedent",
        "risk",
        "risk",
        "queued",
    ],
    "review": [
        "signed",
        "signed",
        "counsel",
        "synthesis",
        "counsel",
        "signed",
        "signed",
    ],
    "signoff": [
        "signed",
        "signed",
        "signed",
        "signed",
        "counsel",
        "signed",
        "signed",
    ],
}

_COLUMN_AGENT: Dict[str, str] = {
    "queued": "Unassigned",
    "risk": "Risk Agent · NIM",
    "precedent": "Precedent Agent · Neo4j",
    "research": "Research Agent · Perplexity",
    "synthesis": "Deal Agent · Gemini",
    "counsel": "Awaiting Counsel",
    "signed": "Signed",
}


def _card_tier(ref: str, column: str) -> int:
    high = {"§9.1": 3, "§7.3": 3, "§4.1": 2, "§8.2": 2}
    if column == "signed":
        return 1
    return high.get(ref, 1)


def list_tasks(matter_id: str) -> Dict[str, Any]:
    """Return the Coordinate-stage board for a matter: workstream cards keyed by
    pipeline column, reflecting where each is in the multi-agent mesh."""
    matter = get_matter(matter_id)
    stage = matter["stage"] if matter else "coordinate"
    matter_name = matter["name"] if matter else matter_id
    dist = _STAGE_DISTRIBUTION.get(stage, _STAGE_DISTRIBUTION["coordinate"])

    tasks: List[Dict[str, Any]] = []
    for i, ws in enumerate(_WORKSTREAMS):
        column = dist[i % len(dist)]
        tier = _card_tier(ws["ref"], column)
        flagged = column == "counsel"
        tasks.append(
            {
                "id": f"{matter_id}-{ws['ref'].strip('§').replace('.', '')}",
                "ref": ws["ref"],
                "title": ws["title"],
                "column": column,
                "agent": _COLUMN_AGENT[column],
                "tier": tier,
                "flagged": flagged,
                "note": (
                    "Exception above policy envelope — needs partner decision."
                    if flagged
                    else ""
                ),
            }
        )

    counts = {c: sum(1 for t in tasks if t["column"] == c) for c in TASK_COLUMNS}
    return {
        "matter_id": matter_id,
        "matter_name": matter_name,
        "stage": stage,
        "columns": list(TASK_COLUMNS),
        "tasks": tasks,
        "counts": counts,
    }
