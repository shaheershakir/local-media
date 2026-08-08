"""
LocalFeed configuration — loaded from .env at startup.
All paths are resolved to absolute and validated on load.
"""
from __future__ import annotations

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from the backend directory (or parent if not found there)
_env_path = Path(__file__).parent.parent / ".env"
if not _env_path.exists():
    _env_path = Path(__file__).parent.parent / ".env.example"
load_dotenv(_env_path)


def _resolve_dir(env_var: str, default_subdir: str) -> Path:
    """Return a resolved Path for a directory, creating it if needed."""
    raw = os.environ.get(env_var, "").strip()
    if raw:
        p = Path(raw).expanduser().resolve()
    else:
        p = Path.home() / ".localfeed" / default_subdir
    p.mkdir(parents=True, exist_ok=True)
    return p


def _parse_media_roots() -> list[Path]:
    raw = os.environ.get("MEDIA_ROOTS", "").strip()
    if not raw:
        return []
    raw = raw.strip('"').strip("'")
    roots = []
    for part in raw.split(","):
        part = part.strip().strip('"').strip("'")
        if not part:
            continue
        p = Path(part).expanduser().resolve()
        if not p.exists():
            # Log warning but don't crash — scanner will skip missing roots
            print(f"[config] WARNING: MEDIA_ROOTS entry does not exist: {p}")
        roots.append(p)
    return roots


# ── Paths ──────────────────────────────────────────────────────────────────
MEDIA_ROOTS: list[Path] = _parse_media_roots()
THUMBNAIL_DIR: Path = _resolve_dir("THUMBNAIL_DIR", "thumbnails")
TRANSCODED_DIR: Path = _resolve_dir("TRANSCODED_DIR", "transcoded")
DB_PATH: Path = (
    Path(os.environ.get("DB_PATH", "").strip()).expanduser().resolve()
    if os.environ.get("DB_PATH", "").strip()
    else Path.home() / ".localfeed" / "localfeed.db"
)
DB_PATH.parent.mkdir(parents=True, exist_ok=True)

# ── Server ─────────────────────────────────────────────────────────────────
HOST: str = os.environ.get("HOST", "127.0.0.1")
PORT: int = int(os.environ.get("PORT", "8000"))

# ── Tuning ─────────────────────────────────────────────────────────────────
MAX_PAGE_SIZE: int = int(os.environ.get("MAX_PAGE_SIZE", "50"))
THUMBNAIL_WIDTH: int = int(os.environ.get("THUMBNAIL_WIDTH", "400"))
THUMBNAIL_WORKERS: int = int(os.environ.get("THUMBNAIL_WORKERS", "2"))
SCAN_METADATA_WORKERS: int = int(os.environ.get("SCAN_METADATA_WORKERS", "8"))
SCAN_DB_BATCH_SIZE: int = int(os.environ.get("SCAN_DB_BATCH_SIZE", "1000"))

# In-memory ID cache TTL (seconds) — used by feed random sampling
ID_CACHE_TTL: int = 300  # 5 minutes

# Video formats/codecs the browser can play natively (no transcode needed)
BROWSER_NATIVE_CODECS = frozenset(
    {
        "h264",
        "avc1",
        "hevc",
        "h265",
        "vp8",
        "vp9",
        "av1",
        "theora",
    }
)
BROWSER_NATIVE_CONTAINERS = frozenset({"mp4", "webm", "mov", "m4v", "ogv", "ogg", "mkv"})

# Video file extensions to scan
VIDEO_EXTENSIONS = frozenset(
    {
        ".mp4", ".mkv", ".mov", ".avi", ".wmv", ".webm",
        ".m4v", ".flv", ".ts", ".mts", ".m2ts", ".mpg",
        ".mpeg", ".3gp", ".ogv", ".gif",
    }
)

# Image file extensions to scan
IMAGE_EXTENSIONS = frozenset(
    {
        ".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif",
        ".bmp", ".tiff", ".tif",
    }
)
