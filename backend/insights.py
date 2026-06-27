"""SignOff backend — portfolio learning & proactive supervision insights.

Two supervision capabilities the brief calls for:

  1. Help partners *scrutinise* work across the portfolio — surface the
     cross-matter patterns a supervisor should look at: critical exceptions,
     matters drifting below their compliance band, recurring high-risk areas,
     and how often partners are departing from the AI's recommendation.

  2. Proactively *suggest how to plan and coordinate* a new matter — learned
     from how comparable matters in the portfolio were actually set up. As more
     matters are planned, the suggestions sharpen: confidence rises with the
     number of comparable matters, and the recommended compliance score is
     drawn from how those matters actually cleared.

Everything is derived live from the in-memory portfolio (``matters.py``) and the
audit trail (``audit.py``), so suggestions genuinely adapt as matters are added
and decisions are recorded — the "gets better over time" behaviour, demonstrable
end-to-end without any external service.
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List

import audit
from matters import list_matters

# Reviewers a partner can actually assign on the Plan screen (display names must
# match AGENT_OPTIONS in the frontend). "Harvey" and similar appear in demo
# matters but are not selectable, so they are excluded from suggestions.
_VALID_REVIEWERS = {
    "NVIDIA Nemotron",
    "Gemini 2.5 Flash",
    "Perplexity",
    "Claude 3.5 Sonnet",
}

# Per practice area: the workstreams, reviewers, red-lines and risk hotspots a
# supervising partner would typically want. This is the starting point for a
# plan suggestion; it is then refined with the actual portfolio.
_PLAYBOOKS: Dict[str, Dict[str, Any]] = {
    "M&A / Antitrust": {
        "threshold": 92,
        "scope": [
            "Warranties & Indemnities",
            "Merger Control & FDI",
            "Material Adverse Change",
            "Interim Covenants",
        ],
        "redlines": [
            "No remedies offered to competition authorities without partner approval",
            "No uncapped indemnities without partner sign-off",
        ],
        "reviewers": ["NVIDIA Nemotron", "Gemini 2.5 Flash", "Perplexity"],
        "hotspots": [
            {"area": "Merger Control & FDI", "tier": 3, "why": "Filing thresholds and remedies are deal-critical and regulator-driven."},
            {"area": "Material Adverse Change", "tier": 3, "why": "MAC wording governs walk-away rights; small changes shift risk materially."},
            {"area": "Warranties & Indemnities", "tier": 2, "why": "Caps, baskets and survival periods set the liability envelope."},
        ],
    },
    "Private Equity": {
        "threshold": 90,
        "scope": [
            "Consideration & Completion Accounts",
            "Warranties & Indemnities",
            "Interim Covenants",
            "Data Protection",
        ],
        "redlines": [
            "No uncapped indemnities without partner sign-off",
            "No locked-box leakage without an indemnity",
        ],
        "reviewers": ["NVIDIA Nemotron", "Gemini 2.5 Flash", "Claude 3.5 Sonnet"],
        "hotspots": [
            {"area": "Consideration & Completion Accounts", "tier": 3, "why": "Locked-box vs completion-accounts mechanics drive the price and leakage risk."},
            {"area": "Warranties & Indemnities", "tier": 3, "why": "W&I insurance interaction and caps are heavily negotiated."},
            {"area": "Data Protection", "tier": 2, "why": "Cross-border transfers in the target raise diligence and indemnity questions."},
        ],
    },
    "Leveraged Finance": {
        "threshold": 90,
        "scope": [
            "Warranties & Indemnities",
            "Interim Covenants",
            "Sanctions & ABC",
            "Governing Law",
        ],
        "redlines": [
            "No financial covenant loosening without partner approval",
            "No sanctions carve-out narrowing without partner approval",
        ],
        "reviewers": ["NVIDIA Nemotron", "Gemini 2.5 Flash", "Perplexity"],
        "hotspots": [
            {"area": "Interim Covenants", "tier": 3, "why": "Covenant package and baskets define lender protection and headroom."},
            {"area": "Sanctions & ABC", "tier": 3, "why": "Sanctions and anti-bribery reps carry regulatory and reputational exposure."},
        ],
    },
    "Equity Capital Markets": {
        "threshold": 90,
        "scope": [
            "Data Protection",
            "Warranties & Indemnities",
            "Sanctions & ABC",
            "Governing Law",
        ],
        "redlines": [
            "No prospectus disclosure gaps left unresolved at sign-off",
            "No underwriting indemnity changes without partner approval",
        ],
        "reviewers": ["Gemini 2.5 Flash", "Perplexity", "Claude 3.5 Sonnet"],
        "hotspots": [
            {"area": "Warranties & Indemnities", "tier": 3, "why": "Underwriting and prospectus liability sit at the centre of an ECM deal."},
            {"area": "Sanctions & ABC", "tier": 2, "why": "Investor and selling-shareholder due diligence drives disclosure."},
        ],
    },
    "Energy & Infrastructure": {
        "threshold": 93,
        "scope": [
            "Material Adverse Change",
            "Interim Covenants",
            "Merger Control & FDI",
            "Governing Law",
        ],
        "redlines": [
            "No change-in-law risk allocation shifted without partner approval",
            "No regulatory consent condition waived without partner sign-off",
        ],
        "reviewers": ["Gemini 2.5 Flash", "Perplexity"],
        "hotspots": [
            {"area": "Merger Control & FDI", "tier": 3, "why": "Critical-infrastructure FDI screening is increasingly decisive."},
            {"area": "Material Adverse Change", "tier": 2, "why": "Long build/operate horizons make MAC and change-in-law allocation key."},
        ],
    },
    "Real Estate": {
        "threshold": 95,
        "scope": [
            "Consideration & Completion Accounts",
            "Warranties & Indemnities",
            "Governing Law",
        ],
        "redlines": [
            "No title or environmental indemnity removed without partner approval",
        ],
        "reviewers": ["Gemini 2.5 Flash", "NVIDIA Nemotron"],
        "hotspots": [
            {"area": "Warranties & Indemnities", "tier": 2, "why": "Title, environmental and tenancy warranties carry the principal risk."},
        ],
    },
    "Funds": {
        "threshold": 92,
        "scope": [
            "Data Protection",
            "Sanctions & ABC",
            "Governing Law",
        ],
        "redlines": [
            "No investor side-letter MFN breach without partner approval",
        ],
        "reviewers": ["Gemini 2.5 Flash", "Perplexity"],
        "hotspots": [
            {"area": "Sanctions & ABC", "tier": 2, "why": "Investor onboarding and AML/KYC drive the principal compliance load."},
        ],
    },
}

_DEFAULT_PLAYBOOK: Dict[str, Any] = {
    "threshold": 95,
    "scope": ["Warranties & Indemnities", "Governing Law"],
    "redlines": ["No uncapped indemnities without partner sign-off"],
    "reviewers": ["NVIDIA Nemotron", "Gemini 2.5 Flash"],
    "hotspots": [
        {"area": "Warranties & Indemnities", "tier": 2, "why": "Liability caps and indemnities typically carry the principal risk."},
    ],
}


def _most_common_reviewers(matters: List[Dict[str, Any]]) -> List[str]:
    """The reviewers most often deployed across comparable matters."""
    counter: Counter[str] = Counter()
    for m in matters:
        for agent in m.get("agents_deployed", []):
            if agent in _VALID_REVIEWERS:
                counter[agent] += 1
    return [agent for agent, _ in counter.most_common(3)]


def suggest_plan(
    asset_class: str, jurisdiction: str = "", deal_size: str = ""
) -> Dict[str, Any]:
    """Proactively suggest how to plan a new matter, learned from the portfolio.

    Blends a practice-area playbook with what comparable matters in the live
    portfolio actually used — so the recommendation improves as more matters of
    this kind are planned.
    """
    matters = list_matters()["matters"]
    playbook = _PLAYBOOKS.get(asset_class, _DEFAULT_PLAYBOOK)
    similar = [m for m in matters if m.get("asset_class") == asset_class]
    based_on = len(similar)

    if similar:
        avg_env = round(sum(m["compliance_envelope"] for m in similar) / based_on)
        threshold = max(80, min(99, avg_env))
        reviewers = _most_common_reviewers(similar) or playbook["reviewers"]
        names = [m["name"] for m in similar][:4]
        rationale = (
            f"Learned from {based_on} comparable {asset_class} matter"
            f"{'' if based_on == 1 else 's'} in your portfolio"
            + (f" ({', '.join(names)})" if names else "")
            + f", which cleared at an average compliance score of {avg_env}%."
        )
    else:
        avg_env = None
        threshold = int(playbook["threshold"])
        reviewers = list(playbook["reviewers"])
        names = []
        rationale = (
            f"No comparable {asset_class} matters yet — starting from the standard "
            f"{asset_class} playbook. These suggestions sharpen as you plan more "
            f"matters of this kind."
        )

    # Confidence grows as the portfolio accumulates comparable matters.
    confidence = round(min(0.9, 0.45 + 0.12 * based_on), 2)

    return {
        "asset_class": asset_class,
        "jurisdiction": jurisdiction,
        "compliance_threshold": threshold,
        "escalation_tier": 3,
        "reviewers": reviewers,
        "scope": list(playbook["scope"]),
        "redlines": list(playbook["redlines"]),
        "hotspots": list(playbook["hotspots"]),
        "similar_matters": names,
        "based_on": based_on,
        "confidence": confidence,
        "rationale": rationale,
        "avg_compliance": avg_env,
    }


def _compliance_by_asset_class(matters: List[Dict[str, Any]]) -> Dict[str, int]:
    """Average compliance score per practice area across the portfolio."""
    buckets: Dict[str, List[int]] = {}
    for m in matters:
        buckets.setdefault(m["asset_class"], []).append(m["compliance_envelope"])
    return {ac: round(sum(v) / len(v)) for ac, v in buckets.items() if v}


def _count_for_class(matters: List[Dict[str, Any]], asset_class: str) -> int:
    return sum(1 for m in matters if m["asset_class"] == asset_class)


def portfolio_insights() -> Dict[str, Any]:
    """Cross-matter patterns a supervising partner should scrutinise."""
    matters = list_matters()["matters"]
    events = audit.list_events(limit=1000)
    signoffs = [e for e in events if e.get("type") == "signoff"]

    patterns: List[Dict[str, Any]] = []

    # 1. Critical exceptions awaiting a partner decision.
    critical = [
        m for m in matters if m["blockers"]["tier"] >= 3 and m["blockers"]["count"] > 0
    ]
    if critical:
        n = len(critical)
        subject = "1 matter" if n == 1 else f"{n} matters"
        verb = "carries" if n == 1 else "carry"
        patterns.append(
            {
                "title": f"{subject} {verb} critical blocker exceptions",
                "detail": "Tier 3 findings that cannot clear without your decision.",
                "severity": "high",
                "matters": [m["name"] for m in critical],
            }
        )

    # 2. Matters drifting below their practice-area compliance band.
    benchmarks = _compliance_by_asset_class(matters)
    drifting: List[str] = []
    for m in matters:
        avg = benchmarks.get(m["asset_class"])
        if avg is not None and m["compliance_envelope"] < avg - 10:
            drifting.append(
                f"{m['name']} ({m['compliance_envelope']}% vs {avg}% typical)"
            )
    if drifting:
        n = len(drifting)
        subject = "1 matter is" if n == 1 else f"{n} matters are"
        patterns.append(
            {
                "title": f"{subject} below the typical compliance band for its practice area",
                "detail": "; ".join(drifting),
                "severity": "medium",
                "matters": [],
            }
        )

    # 3. Junior escalations awaiting the partner.
    escalating = [m for m in matters if m["status"] == "escalate"]
    if escalating:
        n = len(escalating)
        subject = "1 matter has" if n == 1 else f"{n} matters have"
        patterns.append(
            {
                "title": f"{subject} escalations awaiting you",
                "detail": "Junior reviewers have asked for a partner decision.",
                "severity": "medium",
                "matters": [m["name"] for m in escalating],
            }
        )

    # 4. Recurring critical-risk area across the portfolio (learned from playbooks).
    hot: Counter[str] = Counter()
    for m in matters:
        playbook = _PLAYBOOKS.get(m["asset_class"])
        if playbook:
            for h in playbook["hotspots"]:
                if h["tier"] >= 3:
                    hot[h["area"]] += 1
    if hot:
        area, count = hot.most_common(1)[0]
        if count >= 2:
            patterns.append(
                {
                    "title": f"'{area}' is the most common critical-risk area in your portfolio",
                    "detail": (
                        f"A Tier 3 focus on {count} of your {len(matters)} live matters "
                        f"— worth a consistent review standard."
                    ),
                    "severity": "low",
                    "matters": [],
                }
            )

    # 5. How often partners are departing from the AI's recommendation.
    if signoffs:
        overrides = [e for e in signoffs if (e.get("data") or {}).get("override")]
        if overrides:
            rate = round(100 * len(overrides) / len(signoffs))
            patterns.append(
                {
                    "title": f"Partners overrode the AI on {rate}% of recent sign-offs",
                    "detail": (
                        "Where overrides cluster, the AI's recommendations may need "
                        "recalibrating to your firm's standards."
                    ),
                    "severity": "medium" if rate >= 30 else "low",
                    "matters": [],
                }
            )

    benchmark_rows = [
        {
            "asset_class": ac,
            "avg_compliance": avg,
            "matters": _count_for_class(matters, ac),
        }
        for ac, avg in sorted(benchmarks.items(), key=lambda kv: kv[1])
    ]

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "learned_from": {"matters": len(matters), "decisions": len(signoffs)},
        "patterns": patterns,
        "benchmarks": benchmark_rows,
    }
