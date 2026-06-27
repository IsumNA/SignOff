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
engine remains Gemini 2.5 Flash / NIM / Neo4j / Perplexity.
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
#
# Illustrative demo portfolio modelled on Clifford Chance's core practice areas
# (Private Equity, Energy & Infrastructure, Capital Markets, Leveraged Finance,
# M&A/Antitrust, Real Estate). Clients/counterparties are well-known public
# companies used purely as realistic placeholders for the demo — not a record of
# any actual engagement.
_MATTERS: List[Dict[str, Any]] = [
    {
        "id": "pennine",
        "name": "Project Pennine",
        "asset_class": "Private Equity",
        "client": "CVC Capital Partners",
        "counterparty": "Recordati S.p.A.",
        "jurisdiction": "English & Italian law",
        "deal_size": "€6.7bn",
        "agents_deployed": ["Gemini 2.5 Flash", "Claude 3.5 Sonnet", "NVIDIA Nemotron"],
        "compliance_envelope": 86,
        "blockers": {"count": 2, "tier": 3, "label": "Blocker Exceptions"},
        "status": "review",
        "stage": "review",
        "action": "review",
    },
    {
        "id": "mersey",
        "name": "Project Mersey",
        "asset_class": "M&A / Antitrust",
        "client": "Vodafone Group plc",
        "counterparty": "CK Hutchison (Three UK)",
        "jurisdiction": "English law",
        "deal_size": "£15.0bn",
        "agents_deployed": ["Gemini 2.5 Flash", "Perplexity", "NVIDIA Nemotron"],
        "compliance_envelope": 81,
        "blockers": {"count": 1, "tier": 3, "label": "Merger Control Hold"},
        "status": "review",
        "stage": "review",
        "action": "review",
    },
    {
        "id": "severn",
        "name": "Project Severn",
        "asset_class": "Energy & Infrastructure",
        "client": "Macquarie Asset Management",
        "counterparty": "National Grid plc",
        "jurisdiction": "English law",
        "deal_size": "£4.2bn",
        "agents_deployed": ["Gemini 2.5 Flash", "Perplexity"],
        "compliance_envelope": 93,
        "blockers": {"count": 1, "tier": 2, "label": "Warning"},
        "status": "warning",
        "stage": "review",
        "action": "review",
    },
    {
        "id": "camden",
        "name": "Project Camden",
        "asset_class": "Equity Capital Markets",
        "client": "Barclays Bank PLC (Sponsor)",
        "counterparty": "London Stock Exchange listing",
        "jurisdiction": "English law",
        "deal_size": "£1.1bn",
        "agents_deployed": ["Gemini 2.5 Flash", "Harvey"],
        "compliance_envelope": 68,
        "blockers": {"count": 4, "tier": 2, "label": "Escalate Requests"},
        "status": "escalate",
        "stage": "coordinate",
        "action": "review",
    },
    {
        "id": "tay",
        "name": "Project Tay",
        "asset_class": "Leveraged Finance",
        "client": "Blackstone Credit",
        "counterparty": "Deutsche Bank (Arranger)",
        "jurisdiction": "New York & English law",
        "deal_size": "$3.5bn",
        "agents_deployed": ["Gemini 2.5 Flash", "NVIDIA Nemotron", "Perplexity"],
        "compliance_envelope": 100,
        "blockers": {"count": 0, "tier": 0, "label": "Passed Controls"},
        "status": "passed",
        "stage": "signoff",
        "action": "signoff",
    },
    {
        "id": "thames",
        "name": "Project Thames",
        "asset_class": "Real Estate",
        "client": "Brookfield Asset Management",
        "counterparty": "British Land Company plc",
        "jurisdiction": "English law",
        "deal_size": "£2.3bn",
        "agents_deployed": ["Gemini 2.5 Flash", "NVIDIA Nemotron"],
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
    agents = [a for a in (data.get("agents_deployed") or []) if a] or ["Gemini 2.5 Flash"]
    envelope = int(data.get("envelope_target") or 100)
    envelope = max(0, min(100, envelope))

    matter = {
        "id": _slugify(name),
        "name": name,
        "asset_class": (data.get("asset_class") or "M&A").strip(),
        "client": (data.get("client") or "").strip() or None,
        "counterparty": (data.get("counterparty") or "").strip() or None,
        "deal_size": (data.get("deal_size") or "—").strip(),
        "agents_deployed": agents,
        "compliance_envelope": envelope,
        "blockers": {"count": 0, "tier": 0, "label": "Reviewers assigned"},
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
# Canonical workstreams a Clifford Chance corporate matter is decomposed into.
# Each becomes a card that flows across the mesh pipeline on the Coordinate
# board — mirroring the diligence/negotiation streams a supervising partner
# actually oversees on a cross-border transaction.
_WORKSTREAMS: List[Dict[str, str]] = [
    {"ref": "§3.1", "title": "Consideration & Completion Accounts"},
    {"ref": "§5.2", "title": "Conduct of Business (Interim Covenants)"},
    {"ref": "§8.4", "title": "Material Adverse Change"},
    {"ref": "§9.3", "title": "Data Protection & International Transfers"},
    {"ref": "§11.1", "title": "Warranties, Limitations & Indemnities"},
    {"ref": "§12.5", "title": "Sanctions, ABC & Export Controls"},
    {"ref": "§14.2", "title": "Conditions: Merger Control & FDI"},
    {"ref": "§17.3", "title": "Governing Law & Jurisdiction"},
]

# Per lifecycle stage, how the 8 workstreams distribute across the board.
# Index i of the tuple = workstream i's column.
_STAGE_DISTRIBUTION: Dict[str, List[str]] = {
    "plan": ["queued"] * 8,
    "coordinate": [
        "signed",
        "synthesis",
        "research",
        "precedent",
        "risk",
        "risk",
        "queued",
        "queued",
    ],
    "review": [
        "signed",
        "signed",
        "counsel",
        "synthesis",
        "counsel",
        "research",
        "counsel",
        "signed",
    ],
    "signoff": [
        "signed",
        "signed",
        "signed",
        "signed",
        "signed",
        "signed",
        "counsel",
        "signed",
    ],
}

_COLUMN_AGENT: Dict[str, str] = {
    "queued": "Unassigned",
    "risk": "Risk review · NVIDIA Nemotron",
    "precedent": "Precedent search · Neo4j",
    "research": "Legal research · Perplexity + EU",
    "synthesis": "Recommendation · Gemini",
    "counsel": "Awaiting counsel",
    "signed": "Signed",
}


def _card_tier(ref: str, column: str) -> int:
    high = {"§8.4": 3, "§11.1": 3, "§14.2": 3, "§5.2": 2, "§9.3": 2, "§12.5": 2}
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
