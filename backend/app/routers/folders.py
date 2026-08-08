"""
Folders router — folder/tag listing and profile pages.

GET   /api/folders        — list all top-level folders
GET   /api/folders/{id}   — folder detail with paginated media
PATCH /api/folders/{id}   — update display_name
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional

from app.db import get_db

router = APIRouter(prefix="/api/folders", tags=["folders"])


def _row_to_folder(row) -> dict:
    d = dict(row)
    d["display_name"] = d.get("display_name") or d.get("name")
    return d


@router.get("")
def list_folders(
    parent_id: Optional[int] = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """
    List folders. If parent_id is None, returns top-level folders (no parent).
    Supports pagination.
    """
    offset = (page - 1) * page_size
    with get_db() as conn:
        if parent_id is None:
            rows = conn.execute(
                """
                SELECT * FROM folders
                WHERE parent_folder_id IS NULL AND (
                    item_count > 0
                    OR EXISTS (SELECT 1 FROM media_items m WHERE m.folder_id = folders.id AND m.is_active = 1)
                )
                ORDER BY name ASC
                LIMIT ? OFFSET ?
                """,
                (page_size, offset),
            ).fetchall()
            total = conn.execute(
                """
                SELECT COUNT(*) FROM folders
                WHERE parent_folder_id IS NULL AND (
                    item_count > 0
                    OR EXISTS (SELECT 1 FROM media_items m WHERE m.folder_id = folders.id AND m.is_active = 1)
                )
                """
            ).fetchone()[0]
        else:
            rows = conn.execute(
                """
                SELECT * FROM folders
                WHERE parent_folder_id = ? AND (
                    item_count > 0
                    OR EXISTS (SELECT 1 FROM media_items m WHERE m.folder_id = folders.id AND m.is_active = 1)
                )
                ORDER BY name ASC
                LIMIT ? OFFSET ?
                """,
                (parent_id, page_size, offset),
            ).fetchall()
            total = conn.execute(
                """
                SELECT COUNT(*) FROM folders
                WHERE parent_folder_id = ? AND (
                    item_count > 0
                    OR EXISTS (SELECT 1 FROM media_items m WHERE m.folder_id = folders.id AND m.is_active = 1)
                )
                """,
                (parent_id,),
            ).fetchone()[0]

    return {
        "items": [_row_to_folder(r) for r in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/{folder_id}")
def get_folder(
    folder_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
    sort: str = Query("newest"),
):
    """Get folder detail with paginated media items (direct + descendants) and subfolders."""
    with get_db() as conn:
        folder = conn.execute(
            "SELECT * FROM folders WHERE id = ?", (folder_id,)
        ).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

        # Immediate subfolders
        subfolders = conn.execute(
            """
            SELECT * FROM folders WHERE parent_folder_id = ? AND item_count > 0
            ORDER BY name ASC
            """,
            (folder_id,),
        ).fetchall()

        # Media items with sort (direct and recursive descendant media items)
        order_clause = {
            "newest": "file_modified_at DESC",
            "oldest": "file_modified_at ASC",
            "duration": "duration_seconds DESC NULLS LAST",
            "favorites": "is_favorite DESC, file_modified_at DESC",
            "random": "RANDOM()",
        }.get(sort, "file_modified_at DESC")

        offset = (page - 1) * page_size
        media_rows = conn.execute(
            f"""
            WITH RECURSIVE subfolder_ids(id) AS (
                SELECT ?
                UNION ALL
                SELECT f.id FROM folders f
                JOIN subfolder_ids s ON f.parent_folder_id = s.id
            )
            SELECT * FROM media_items
            WHERE folder_id IN (SELECT id FROM subfolder_ids) AND is_active = 1
            ORDER BY {order_clause}
            LIMIT ? OFFSET ?
            """,
            (folder_id, page_size, offset),
        ).fetchall()

        total_media = conn.execute(
            """
            WITH RECURSIVE subfolder_ids(id) AS (
                SELECT ?
                UNION ALL
                SELECT f.id FROM folders f
                JOIN subfolder_ids s ON f.parent_folder_id = s.id
            )
            SELECT COUNT(*) FROM media_items
            WHERE folder_id IN (SELECT id FROM subfolder_ids) AND is_active = 1
            """,
            (folder_id,),
        ).fetchone()[0]

    folder_dict = _row_to_folder(folder)
    return {
        "folder": folder_dict,
        "subfolders": [_row_to_folder(r) for r in subfolders],
        "media": {
            "items": [dict(r) for r in media_rows],
            "total": total_media,
            "page": page,
            "page_size": page_size,
            "pages": max(1, (total_media + page_size - 1) // page_size),
        },
    }


class FolderPatch(BaseModel):
    display_name: Optional[str] = None


@router.patch("/{folder_id}")
def update_folder(folder_id: int, patch: FolderPatch):
    """Update folder display name without touching the filesystem."""
    with get_db() as conn:
        folder = conn.execute(
            "SELECT id FROM folders WHERE id = ?", (folder_id,)
        ).fetchone()
        if not folder:
            raise HTTPException(status_code=404, detail="Folder not found")

        if patch.display_name is not None:
            conn.execute(
                "UPDATE folders SET display_name = ? WHERE id = ?",
                (patch.display_name.strip() or None, folder_id),
            )
    return {"status": "ok"}
