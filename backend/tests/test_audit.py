"""Tests for the tamper-evident audit trail (the auditability guarantee).

These prove the core claim SignOff makes to a supervising partner: the decision
record cannot be edited, deleted, or reordered after the fact without it being
provable. Each test isolates the chain to a temp file so it never touches the
real ``audit_log.jsonl``.
"""

from __future__ import annotations

import pytest

import audit


@pytest.fixture
def fresh_audit(tmp_path, monkeypatch):
    """Point the audit chain at an empty temp file and reset in-memory state."""
    monkeypatch.setattr(audit, "_AUDIT_FILE", tmp_path / "audit_log.jsonl")
    monkeypatch.setattr(audit, "_events", [])
    monkeypatch.setattr(audit, "_loaded", False)
    return audit


def test_clean_chain_verifies(fresh_audit):
    a = fresh_audit
    a.record_event("matter_planned", summary="one")
    a.record_event("analysis", summary="two")
    a.record_event("signoff", summary="three")

    result = a.verify_chain()
    assert result["ok"] is True
    assert result["count"] == 3
    assert result["broken_at"] is None


def test_first_record_links_to_genesis(fresh_audit):
    a = fresh_audit
    rec = a.record_event("analysis", summary="first")
    assert rec["prev_hash"] == a._GENESIS_HASH
    assert rec["seq"] == 1
    assert len(rec["hash"]) == 64


def test_records_are_chained(fresh_audit):
    a = fresh_audit
    first = a.record_event("analysis", summary="first")
    second = a.record_event("signoff", summary="second")
    # Each record embeds the previous record's hash.
    assert second["prev_hash"] == first["hash"]


def test_editing_a_record_breaks_the_chain(fresh_audit):
    """A retroactive edit must be detectable."""
    a = fresh_audit
    a.record_event("analysis", summary="original decision")
    a.record_event("signoff", summary="approved")
    assert a.verify_chain()["ok"] is True

    # Tamper: someone edits the rationale of the first record after the fact.
    a._events[0]["summary"] = "tampered decision"

    result = a.verify_chain()
    assert result["ok"] is False
    assert result["broken_at"] == 1


def test_editing_nested_data_breaks_the_chain(fresh_audit):
    a = fresh_audit
    a.record_event("signoff", summary="signed", data={"posture": "reject"})
    assert a.verify_chain()["ok"] is True

    # Flip the recorded decision from reject to approve.
    a._events[0]["data"]["posture"] = "approve"

    assert a.verify_chain()["ok"] is False


def test_deleting_a_record_breaks_the_chain(fresh_audit):
    a = fresh_audit
    a.record_event("analysis", summary="one")
    a.record_event("analysis", summary="two")
    a.record_event("signoff", summary="three")
    assert a.verify_chain()["ok"] is True

    # Remove the middle record — the link from #3 back to #2 no longer holds.
    del a._events[1]

    assert a.verify_chain()["ok"] is False


def test_reordering_breaks_the_chain(fresh_audit):
    a = fresh_audit
    a.record_event("analysis", summary="one")
    a.record_event("signoff", summary="two")
    assert a.verify_chain()["ok"] is True

    a._events.reverse()

    assert a.verify_chain()["ok"] is False


def test_listing_is_newest_first_and_scoped(fresh_audit):
    a = fresh_audit
    a.record_event("analysis", matter_id="m-1", summary="m1 analysis")
    a.record_event("analysis", matter_id="m-2", summary="m2 analysis")
    a.record_event("signoff", matter_id="m-1", summary="m1 signoff")

    all_events = a.list_events()
    assert [e["summary"] for e in all_events][0] == "m1 signoff"  # newest first

    scoped = a.list_events(matter_id="m-1")
    assert {e["matter_id"] for e in scoped} == {"m-1"}
    assert len(scoped) == 2
