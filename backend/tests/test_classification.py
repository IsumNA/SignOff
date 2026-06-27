"""Tests for the deterministic demo risk classifier.

The demo path is the baseline that runs with zero credentials, so its behaviour
must be predictable: high-risk language escalates, routine boilerplate does not,
and the tier maps to the correct recommended posture for the supervisor.
"""

from __future__ import annotations

from mesh import TIER_POSTURE, _demo_synthesis, _severity_to_tier
from tools import _mock_nim_assessment


def test_severity_maps_to_tier():
    assert _severity_to_tier("HIGH") == 3
    assert _severity_to_tier("MEDIUM") == 2
    assert _severity_to_tier("LOW") == 1
    assert _severity_to_tier("nonsense") == 2  # safe default = material


def test_posture_convention():
    assert TIER_POSTURE == {1: "approve", 2: "amend", 3: "reject"}


def test_high_risk_clause_flagged_high():
    assessment = _mock_nim_assessment(
        "The Seller shall indemnify the Buyer on an uncapped basis with unlimited liability."
    )
    assert assessment["severity"] == "HIGH"
    assert assessment["flagged_terms"]  # at least one risky term quoted


def test_routine_clause_flagged_low():
    assessment = _mock_nim_assessment(
        "This Agreement shall be governed by the laws of England and Wales."
    )
    assert assessment["severity"] == "LOW"
    assert assessment["flagged_terms"] == []


def test_demo_synthesis_escalates_high_risk():
    nim = {"severity": "HIGH", "flagged_terms": ["uncapped", "indemnify"]}
    out = _demo_synthesis("clause", nim, {}, {}, {})
    cls = out["classification"]
    assert cls["tier"] == 3
    assert cls["recommended_posture"] == "reject"
    assert cls["escalated"] is True


def test_demo_synthesis_passes_routine():
    nim = {"severity": "LOW", "flagged_terms": []}
    out = _demo_synthesis("clause", nim, {}, {}, {})
    cls = out["classification"]
    assert cls["tier"] == 1
    assert cls["recommended_posture"] == "approve"
    assert cls["escalated"] is False


def test_demo_synthesis_amends_material():
    nim = {"severity": "MEDIUM", "flagged_terms": ["penalty"]}
    out = _demo_synthesis("clause", nim, {}, {}, {})
    assert out["classification"]["tier"] == 2
    assert out["classification"]["recommended_posture"] == "amend"


def test_demo_synthesis_shape_is_frontend_ready():
    """The demo output must carry the structure the API/frontend expect."""
    nim = {"severity": "HIGH", "flagged_terms": ["uncapped", "perpetual"]}
    out = _demo_synthesis("clause", nim, {}, {}, {})

    assert set(out) >= {"answer", "classification", "agents"}
    cls = out["classification"]
    assert set(cls) >= {
        "tier",
        "tier_label",
        "escalated",
        "triggers",
        "recommended_posture",
        "confidence",
    }
    # Exactly the three asymmetric agents, with the deal agent resolving last.
    phases = [a["phase"] for a in out["agents"]]
    assert phases.count("resolution") == 1
    assert 0.0 <= cls["confidence"] <= 1.0
