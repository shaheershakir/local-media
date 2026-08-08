"""
Sources router — manage media root directories at runtime.

GET    /api/sources         — list configured sources
POST   /api/sources         — add a new source path
DELETE /api/sources         — remove a source path
"""
from __future__ import annotations

import os
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import config
from app.db import get_db

router = APIRouter(prefix="/api/sources", tags=["sources"])

_BACKEND_DIR = Path(__file__).parent.parent.parent
_ENV_PATH = _BACKEND_DIR / ".env"


class SourceRequest(BaseModel):
    path: str


def _read_env_media_roots() -> list[str]:
    """Parse MEDIA_ROOTS from the .env file on disk."""
    env_file = _ENV_PATH if _ENV_PATH.exists() else (_BACKEND_DIR / ".env.example")
    if not env_file.exists():
        return []
    text = env_file.read_text(encoding="utf-8")
    for line in text.splitlines():
        stripped = line.strip()
        if stripped.startswith("#") or "=" not in stripped:
            continue
        key, _, value = stripped.partition("=")
        if key.strip() == "MEDIA_ROOTS":
            # Strip surrounding quotes
            value = value.strip().strip('"').strip("'")
            if not value:
                return []
            parts = []
            for p in value.split(","):
                clean = p.strip().strip('"').strip("'")
                if clean:
                    parts.append(clean)
            return parts
    return []


def _write_env_media_roots(roots: list[str]) -> None:
    """Update only the MEDIA_ROOTS line in the .env file cleanly without regex escape issues."""
    new_line = f'MEDIA_ROOTS="{",".join(roots)}"'
    if not _ENV_PATH.exists():
        _ENV_PATH.write_text(new_line + "\n", encoding="utf-8")
        return

    lines = _ENV_PATH.read_text(encoding="utf-8").splitlines()
    found = False
    new_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped.startswith("#") and "=" in stripped:
            key, _, _ = stripped.partition("=")
            if key.strip() == "MEDIA_ROOTS":
                new_lines.append(new_line)
                found = True
                continue
        new_lines.append(line)

    if not found:
        new_lines.append(new_line)

    _ENV_PATH.write_text("\n".join(new_lines).rstrip("\n") + "\n", encoding="utf-8")


def _sync_config(roots: list[str]) -> None:
    """Hot-reload the in-memory MEDIA_ROOTS config in-place."""
    resolved = [Path(r).expanduser().resolve() for r in roots]
    config.MEDIA_ROOTS.clear()
    config.MEDIA_ROOTS.extend(resolved)
    os.environ["MEDIA_ROOTS"] = ",".join(roots)


@router.get("")
def list_sources():
    """Return all configured media root paths with metadata."""
    roots = _read_env_media_roots()
    result = []
    with get_db() as conn:
        for r in roots:
            p = Path(r).expanduser()
            try:
                resolved = p.resolve()
                exists = resolved.exists()
                path_str = str(resolved)
            except Exception:
                exists = False
                path_str = str(p)

            count = 0
            if exists:
                try:
                    row = conn.execute(
                        """
                        WITH RECURSIVE subfolder_ids(id) AS (
                            SELECT id FROM folders WHERE path = ?
                            UNION ALL
                            SELECT f.id FROM folders f
                            JOIN subfolder_ids s ON f.parent_folder_id = s.id
                        )
                        SELECT COUNT(*) FROM media_items
                        WHERE folder_id IN (SELECT id FROM subfolder_ids) AND is_active = 1
                        """,
                        (path_str,),
                    ).fetchone()
                    if row:
                        count = row[0]
                except Exception:
                    pass

            result.append({
                "path": path_str,
                "exists": exists,
                "display": r,
                "item_count": count,
            })
    return {"sources": result}


@router.post("")
def add_source(body: SourceRequest):
    """Add a new media source directory."""
    raw_path = body.path.strip().strip('"').strip("'")
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path cannot be empty.")

    p = Path(raw_path).expanduser()
    try:
        resolved = p.resolve()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid path: {e}")

    if not resolved.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {resolved}")
    if not resolved.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {resolved}")

    roots = _read_env_media_roots()
    existing_resolved: list[str] = []
    for r in roots:
        try:
            existing_resolved.append(str(Path(r).expanduser().resolve()))
        except Exception:
            existing_resolved.append(r)

    target_str = str(resolved)
    if target_str in existing_resolved:
        raise HTTPException(status_code=409, detail="This source is already configured.")

    roots.append(target_str)
    _write_env_media_roots(roots)
    _sync_config(roots)

    # Auto-trigger scan for the new source in background
    from app.scanner import run_scan
    import threading
    threading.Thread(target=run_scan, daemon=True, name="localfeed-scan").start()

    return {"status": "added", "path": target_str}


@router.delete("")
def remove_source(body: SourceRequest):
    """Remove a media source directory."""
    raw_path = body.path.strip().strip('"').strip("'")
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path cannot be empty.")

    target_path = Path(raw_path).expanduser()
    try:
        target_resolved = str(target_path.resolve())
    except Exception:
        target_resolved = str(target_path)

    roots = _read_env_media_roots()
    new_roots: list[str] = []
    found = False
    for r in roots:
        r_path = Path(r).expanduser()
        try:
            r_resolved = str(r_path.resolve())
        except Exception:
            r_resolved = str(r_path)

        if r_resolved == target_resolved or str(r_path) == str(target_path) or r.strip() == raw_path:
            found = True
        else:
            new_roots.append(r)

    if not found:
        raise HTTPException(status_code=404, detail="Source not found.")

    _write_env_media_roots(new_roots)
    _sync_config(new_roots)

    return {"status": "removed", "path": target_resolved}

