"""
Feed router — random feed with efficient ID sampling.

GET /api/feed/random — returns a randomized batch of media items

Random ID sampling strategy (avoids ORDER BY RANDOM() at scale):
- Maintains an in-memory cache of all active media_item IDs.
- Cache is refreshed every ID_CACHE_TTL seconds (default: 5 min).
- To generate a random feed batch: sample N IDs from the cache, fetch those rows.
- Supports exclude_ids to avoid repeating items within a session.
"""
from __future__ import annotations

import random
import time
import threading
from typing import Optional

from fastapi import APIRouter, Query

from app.config import ID_CACHE_TTL
from app.db import get_db

router = APIRouter(prefix="/api/feed", tags=["feed"])

# ── In-memory ID cache ─────────────────────────────────────────────────────

_id_cache: list[int] = []
_id_cache_ts: float = 0.0
_id_cache_lock = threading.Lock()


def _get_cached_ids(media_type: Optional[str] = None) -> list[int]:
    """Return a list of active media_item IDs from cache (refreshed as needed)."""
    global _id_cache, _id_cache_ts

    with _id_cache_lock:
        now = time.monotonic()
        if now - _id_cache_ts > ID_CACHE_TTL or not _id_cache:
            with get_db() as conn:
                rows = conn.execute(
                    "SELECT id FROM media_items WHERE is_active = 1"
                ).fetchall()
            _id_cache = [r[0] for r in rows]
            _id_cache_ts = now

        ids = _id_cache

    if media_type in ("video", "image"):
        # We need to filter by type — do a lightweight DB query
        with get_db() as conn:
            rows = conn.execute(
                "SELECT id FROM media_items WHERE is_active = 1 AND media_type = ?",
                (media_type,),
            ).fetchall()
        return [r[0] for r in rows]

    return ids


def invalidate_id_cache() -> None:
    """Force the ID cache to refresh on next request (call after scan completes)."""
    global _id_cache_ts
    with _id_cache_lock:
        _id_cache_ts = 0.0


# ── Feed endpoint ──────────────────────────────────────────────────────────

@router.get("/random")
def random_feed(
    limit: int = Query(10, ge=1, le=50),
    exclude_ids: str = Query("", description="Comma-separated IDs to exclude"),
    media_type: Optional[str] = Query(None, description="video | image | None for mixed"),
):
    """
    Return a randomized batch of media items for the feed.
    Uses in-memory ID sampling for performance at scale.
    """
    # Parse exclude_ids
    excluded: set[int] = set()
    if exclude_ids:
        for part in exclude_ids.split(","):
            part = part.strip()
            if part.isdigit():
                excluded.add(int(part))

    # Validate media_type
    if media_type not in (None, "video", "image"):
        media_type = None

    all_ids = _get_cached_ids(media_type)

    # Filter excluded
    available = [i for i in all_ids if i not in excluded]

    if not available:
        # All items excluded — reset and return from full pool
        available = all_ids

    # Sample random IDs
    sample_size = min(limit, len(available))
    if sample_size == 0:
        return {"items": [], "total_available": 0}

    sampled_ids = random.sample(available, sample_size)

    # Fetch rows for sampled IDs
    placeholders = ",".join("?" * len(sampled_ids))
    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT m.*, f.name as folder_name, f.display_name as folder_display_name
            FROM media_items m
            JOIN folders f ON m.folder_id = f.id
            WHERE m.id IN ({placeholders}) AND m.is_active = 1
            """,
            sampled_ids,
        ).fetchall()

    # Shuffle results (DB order is by id)
    items = [dict(r) for r in rows]
    random.shuffle(items)

    # Enrich: compute folder display name
    for item in items:
        item["folder_label"] = item.get("folder_display_name") or item.get("folder_name")

    return {
        "items": items,
        "total_available": len(available),
    }
