"""
Sources router — manage media root directories at runtime.

GET    /api/sources         — list configured sources
POST   /api/sources         — add a new source path
DELETE /api/sources         — remove a source path
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import config

router = APIRouter(prefix="/api/sources", tags=["sources"])

_ENV_PATH = Path(__file__).parent.parent.parent / ".env"


class SourceRequest(BaseModel):
    path: str


def _read_env_media_roots() -> list[str]:
    """Parse MEDIA_ROOTS from the .env file on disk."""
    if not _ENV_PATH.exists():
        return []
    text = _ENV_PATH.read_text(encoding="utf-8")
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
            return [p.strip() for p in value.split(",") if p.strip()]
    return []


def _write_env_media_roots(roots: list[str]) -> None:
    """Update only the MEDIA_ROOTS line in the .env file."""
    if not _ENV_PATH.exists():
        _ENV_PATH.write_text(f'MEDIA_ROOTS="{",".join(roots)}"\n', encoding="utf-8")
        return

    text = _ENV_PATH.read_text(encoding="utf-8")
    new_value = f'MEDIA_ROOTS="{",".join(roots)}"'

    # Replace existing MEDIA_ROOTS line
    pattern = re.compile(r"^MEDIA_ROOTS\s*=.*$", re.MULTILINE)
    if pattern.search(text):
        text = pattern.sub(new_value, text)
    else:
        text = text.rstrip("\n") + "\n" + new_value + "\n"

    _ENV_PATH.write_text(text, encoding="utf-8")


def _sync_config(roots: list[str]) -> None:
    """Hot-reload the in-memory MEDIA_ROOTS config."""
    config.MEDIA_ROOTS = [Path(r).expanduser().resolve() for r in roots]


@router.get("")
def list_sources():
    """Return all configured media root paths."""
    roots = _read_env_media_roots()
    result = []
    for r in roots:
        p = Path(r).expanduser().resolve()
        result.append({
            "path": str(p),
            "exists": p.exists(),
            "display": r,
        })
    return {"sources": result}


@router.post("")
def add_source(body: SourceRequest):
    """Add a new media source directory."""
    raw_path = body.path.strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path cannot be empty.")

    p = Path(raw_path).expanduser().resolve()
    if not p.exists():
        raise HTTPException(status_code=400, detail=f"Path does not exist: {p}")
    if not p.is_dir():
        raise HTTPException(status_code=400, detail=f"Path is not a directory: {p}")

    roots = _read_env_media_roots()
    resolved = [str(Path(r).expanduser().resolve()) for r in roots]
    if str(p) in resolved:
        raise HTTPException(status_code=409, detail="This source is already configured.")

    roots.append(str(p))
    _write_env_media_roots(roots)
    _sync_config(roots)

    return {"status": "added", "path": str(p)}


@router.delete("")
def remove_source(body: SourceRequest):
    """Remove a media source directory."""
    raw_path = body.path.strip()
    if not raw_path:
        raise HTTPException(status_code=400, detail="Path cannot be empty.")

    target = str(Path(raw_path).expanduser().resolve())
    roots = _read_env_media_roots()
    new_roots = [
        r for r in roots
        if str(Path(r).expanduser().resolve()) != target
    ]

    if len(new_roots) == len(roots):
        raise HTTPException(status_code=404, detail="Source not found.")

    _write_env_media_roots(new_roots)
    _sync_config(new_roots)

    return {"status": "removed", "path": target}
