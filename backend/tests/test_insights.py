"""Tests for the portfolio-learning layer.

These check the "gets better over time" behaviour: a plan suggestion for a
practice area the portfolio already knows is more confident than one for an
unseen area, and the cross-matter scrutiny insights come back well-formed.
"""

from __future__ import annotations

import insights

_KNOWN = "M&A / Antitrust"  # present in the demo portfolio
_UNKNOWN = "Maritime Salvage Arbitration 9000"  # no comparable matters


def test_plan_suggestion_is_complete():
    s = insights.suggest_plan(_KNOWN)
    assert s["asset_class"] == _KNOWN
    assert s["reviewers"], "should recommend at least one reviewer"
    assert s["scope"], "should recommend a scope"
    assert s["hotspots"], "should flag risk hotspots"
    assert 0.0 <= s["confidence"] <= 1.0
    assert s["compliance_threshold"] >= 80


def test_unknown_area_falls_back_to_playbook():
    s = insights.suggest_plan(_UNKNOWN)
    assert s["based_on"] == 0
    assert s["reviewers"]  # still usable from the default playbook
    assert "sharpen" in s["rationale"].lower()


def test_confidence_rises_with_comparable_matters():
    """Learning signal: more comparable matters → higher confidence."""
    known = insights.suggest_plan(_KNOWN)
    unknown = insights.suggest_plan(_UNKNOWN)
    assert known["based_on"] >= 1
    assert known["confidence"] > unknown["confidence"]


def test_portfolio_insights_are_well_formed():
    p = insights.portfolio_insights()
    assert isinstance(p["patterns"], list)
    assert "matters" in p["learned_from"]
    assert isinstance(p["benchmarks"], list)
    for pattern in p["patterns"]:
        assert pattern["severity"] in {"high", "medium", "low"}
        assert pattern["title"]
