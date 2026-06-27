"""SignOff backend — in-process trace event bus for Server-Sent Events (SSE).

The asymmetric mesh publishes a trace frame the instant each tool/synthesis
*starts* (``status="running"``) and again when it *finishes*
(``status="success"`` | ``"failed"``). The SSE endpoint in :mod:`main` subscribes
per session and streams those frames to the Review workspace in real time, so a
supervising partner watches NIM, Neo4j, Perplexity and the EU Cellar light up
live — full execution transparency, not a post-hoc summary.

Design notes
------------
* Single event loop (uvicorn default) → plain dict + ``asyncio.Queue``; no locks.
* Each session keeps a small **history** buffer so a subscriber that connects a
  few milliseconds after the analysis POST still replays every frame it missed.
* Sessions are pruned lazily (bounded count) so long-running servers don't leak.
"""

from __future__ import annotations

import asyncio
from collections import OrderedDict
from time import time
from typing import Any, Dict, Optional

# Sentinel pushed to subscribers when a session's run is complete.
DONE: Dict[str, Any] = {"__done__": True}

# Keep at most this many sessions resident; evict oldest finished ones beyond it.
_MAX_SESSIONS = 128
# Cap per-session history so a pathological run can't grow unbounded.
_MAX_HISTORY = 200


class _Session:
    __slots__ = ("history", "subscribers", "done", "touched")

    def __init__(self) -> None:
        self.history: list[Dict[str, Any]] = []
        self.subscribers: set[asyncio.Queue] = set()
        self.done: bool = False
        self.touched: float = time()


_sessions: "OrderedDict[str, _Session]" = OrderedDict()


def _prune() -> None:
    """Evict oldest finished, unsubscribed sessions when over the cap."""
    while len(_sessions) > _MAX_SESSIONS:
        for sid, s in list(_sessions.items()):
            if s.done and not s.subscribers:
                _sessions.pop(sid, None)
                break
        else:
            # Nothing safely evictable; drop the strict oldest to bound memory.
            _sessions.popitem(last=False)


def _get(session_id: str) -> _Session:
    s = _sessions.get(session_id)
    if s is None:
        s = _Session()
        _sessions[session_id] = s
        _prune()
    else:
        _sessions.move_to_end(session_id)
    s.touched = time()
    return s


def publish(session_id: str, event: Dict[str, Any]) -> None:
    """Record a trace frame and fan it out to every live subscriber."""
    s = _get(session_id)
    s.history.append(event)
    if len(s.history) > _MAX_HISTORY:
        s.history = s.history[-_MAX_HISTORY:]
    for q in list(s.subscribers):
        q.put_nowait(event)


def mark_done(session_id: str) -> None:
    """Signal that a session's run has finished; closes attached streams."""
    s = _get(session_id)
    s.done = True
    for q in list(s.subscribers):
        q.put_nowait(DONE)


class Subscription:
    """A single SSE client's view of one session: replayed history + live tail."""

    def __init__(self, session: _Session, queue: asyncio.Queue) -> None:
        self._session = session
        self._queue = queue

    async def get(self, timeout: Optional[float] = None) -> Optional[Dict[str, Any]]:
        """Next frame, or ``None`` on heartbeat timeout."""
        if timeout is None:
            return await self._queue.get()
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except asyncio.TimeoutError:
            return None

    def close(self) -> None:
        self._session.subscribers.discard(self._queue)


def subscribe(session_id: str) -> Subscription:
    """Attach to a session; immediately replays any frames already emitted."""
    s = _get(session_id)
    q: asyncio.Queue = asyncio.Queue()
    for ev in list(s.history):
        q.put_nowait(ev)
    if s.done:
        q.put_nowait(DONE)
    s.subscribers.add(q)
    return Subscription(s, q)
