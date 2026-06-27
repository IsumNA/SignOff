"""SignOff backend — tamper-evident audit trail.

An append-only audit log with a SHA-256 **hash chain**: each record embeds the
hash of the previous record, so any retroactive edit, deletion, or reordering
breaks the chain and is provable via :func:`verify_chain`.

Persisted to a local JSONL file so the trail survives restarts and works fully
in demo mode (no Firestore/GCP required). When Firestore is live the same
records are mirrored there by the caller for durable, multi-instance storage.
"""

from __future__ import annotations

import hashlib
import json
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

_AUDIT_FILE = Path(__file__).resolve().parent / "audit_log.jsonl"
_GENESIS_HASH = "0" * 64

_lock = threading.Lock()
_events: List[Dict[str, Any]] = []
_loaded = False


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _canonical(record: Dict[str, Any]) -> str:
    """Deterministic serialization of a record EXCLUDING its own hash."""
    payload = {k: v for k, v in record.items() if k != "hash"}
    return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _compute_hash(record: Dict[str, Any]) -> str:
    return hashlib.sha256(_canonical(record).encode("utf-8")).hexdigest()


def _load() -> None:
    global _loaded
    if _loaded:
        return
    if _AUDIT_FILE.exists():
        with _AUDIT_FILE.open("r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    _events.append(json.loads(line))
                except json.JSONDecodeError:
                    continue
    _loaded = True


def record_event(
    event_type: str,
    *,
    matter_id: Optional[str] = None,
    session_id: Optional[str] = None,
    actor: str = "system",
    summary: str = "",
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Append a new event to the chain and return the persisted record."""
    with _lock:
        _load()
        prev_hash = _events[-1]["hash"] if _events else _GENESIS_HASH
        record: Dict[str, Any] = {
            "seq": len(_events) + 1,
            "id": str(uuid.uuid4()),
            "type": event_type,
            "matter_id": matter_id,
            "session_id": session_id,
            "actor": actor,
            "summary": summary,
            "data": data or {},
            "timestamp": _now(),
            "prev_hash": prev_hash,
        }
        record["hash"] = _compute_hash(record)

        with _AUDIT_FILE.open("a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
        _events.append(record)
        return dict(record)


def list_events(
    matter_id: Optional[str] = None, limit: int = 200
) -> List[Dict[str, Any]]:
    """Return events newest-first, optionally filtered to one matter."""
    with _lock:
        _load()
        items = [
            e
            for e in _events
            if matter_id is None or e.get("matter_id") == matter_id
        ]
        items = list(reversed(items))[: max(0, limit)]
        return [dict(e) for e in items]


def verify_chain() -> Dict[str, Any]:
    """Recompute the chain and report whether it is intact (tamper-evident)."""
    with _lock:
        _load()
        prev = _GENESIS_HASH
        for e in _events:
            if e.get("prev_hash") != prev:
                return {"ok": False, "count": len(_events), "broken_at": e.get("seq")}
            if _compute_hash(e) != e.get("hash"):
                return {"ok": False, "count": len(_events), "broken_at": e.get("seq")}
            prev = e["hash"]
        return {"ok": True, "count": len(_events), "broken_at": None}


def stats() -> Dict[str, Any]:
    """Aggregate counts for the portfolio audit header."""
    with _lock:
        _load()
        by_type: Dict[str, int] = {}
        for e in _events:
            by_type[e["type"]] = by_type.get(e["type"], 0) + 1
        return {"total": len(_events), "by_type": by_type}
