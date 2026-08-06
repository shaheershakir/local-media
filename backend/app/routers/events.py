"""
Events router — write-only event log for future recommendation engine.

POST /api/events   — log a watch/view event (fire and forget)
"""
from __future__ import annotations

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.db import get_db

router = APIRouter(prefix="/api/events", tags=["events"])


class EventPayload(BaseModel):
    media_item_id: int
    event_type: str  # view_start | view_end | skip | favorite | open_from_grid | open_from_feed
    watched_seconds: Optional[float] = None


VALID_EVENT_TYPES = {
    "view_start", "view_end", "skip", "favorite",
    "open_from_grid", "open_from_feed",
}


@router.post("")
def log_event(payload: EventPayload):
    """Log a watch/view event. Never blocks — returns immediately."""
    if payload.event_type not in VALID_EVENT_TYPES:
        return {"status": "ignored", "reason": "invalid event_type"}

    try:
        with get_db() as conn:
            conn.execute(
                """
                INSERT INTO watch_events (media_item_id, event_type, watched_seconds)
                VALUES (?, ?, ?)
                """,
                (payload.media_item_id, payload.event_type, payload.watched_seconds),
            )
            # Update media_items engagement counters for view_end events
            if payload.event_type == "view_end":
                conn.execute(
                    """
                    UPDATE media_items SET
                        watch_count = watch_count + 1,
                        last_watched_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                        duration_watched_seconds = duration_watched_seconds + COALESCE(?, 0)
                    WHERE id = ?
                    """,
                    (payload.watched_seconds, payload.media_item_id),
                )
    except Exception:
        pass  # event logging should never affect the user experience

    return {"status": "ok"}
