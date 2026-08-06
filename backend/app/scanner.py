"""
Filesystem scanner — walks MEDIA_ROOTS, extracts metadata via ffprobe / Pillow,
and upserts into SQLite. Thumbnails are NOT generated here (lazy, on-demand).

Key design decisions:
- Incremental: diffs by (path, file_modified_at) — skips unchanged files.
- Resilient: corrupt/unreadable files are logged and skipped, never crash the scan.
- Marks files missing from disk as is_active=0 (soft delete to preserve history).
- GIFs are classified as media_type='video' (autoplaying in feed).
- HEIC support is guarded — works if pillow-heif is installed, skips gracefully if not.
"""
from __future__ import annotations

import json
import logging
import os
import re
import subprocess
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from app.config import (
    BROWSER_NATIVE_CODECS,
    BROWSER_NATIVE_CONTAINERS,
    IMAGE_EXTENSIONS,
    MEDIA_ROOTS,
    VIDEO_EXTENSIONS,
)
from app.db import get_db

logger = logging.getLogger("localfeed.scanner")

# Try to import pillow-heif; note if unavailable
try:
    import pillow_heif  # noqa: F401

    HEIF_AVAILABLE = True
    pillow_heif.register_heif_opener()
except ImportError:
    HEIF_AVAILABLE = False
    logger.warning(
        "pillow-heif not installed — .heic/.heif files will be skipped. "
        "Install with: pip install pillow-heif"
    )

try:
    from PIL import Image
    from PIL.ExifTags import TAGS

    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logger.error("Pillow not installed — image scanning will be disabled.")


# ── Scan state (global, guarded by a threading.Lock) ──────────────────────

@dataclass
class ScanState:
    running: bool = False
    files_total: int = 0
    files_scanned: int = 0
    files_new: int = 0
    files_updated: int = 0
    files_skipped: int = 0
    errors: int = 0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error_log: list[str] = field(default_factory=list)


_scan_state = ScanState()
_scan_lock = threading.Lock()


def get_scan_state() -> dict:
    with _scan_lock:
        s = _scan_state
        elapsed = 0.0
        est_remaining = None
        if s.started_at and s.running:
            try:
                started = datetime.fromisoformat(s.started_at.replace("Z", "+00:00"))
                elapsed = (datetime.now(timezone.utc) - started).total_seconds()
                if s.files_scanned > 0 and s.files_total > s.files_scanned:
                    rate = s.files_scanned / elapsed if elapsed > 0 else 1
                    remaining = s.files_total - s.files_scanned
                    est_remaining = int(remaining / rate)
            except Exception:
                pass

        return {
            "running": s.running,
            "files_total": s.files_total,
            "files_scanned": s.files_scanned,
            "files_new": s.files_new,
            "files_updated": s.files_updated,
            "files_skipped": s.files_skipped,
            "errors": s.errors,
            "started_at": s.started_at,
            "finished_at": s.finished_at,
            "elapsed_seconds": round(elapsed, 1),
            "estimated_seconds_remaining": est_remaining,
            "recent_errors": s.error_log[-10:],  # last 10 errors
        }


# ── Utility helpers ────────────────────────────────────────────────────────

def _clean_title(filename: str) -> str:
    """Make a human-readable title from a raw filename."""
    stem = Path(filename).stem
    # Replace common separators with spaces
    stem = re.sub(r"[._\-]+", " ", stem)
    # Remove resolution tags like 1080p, 720p, 4K
    stem = re.sub(r"\b(4k|2k|1080p|720p|480p|360p|hd|fhd|uhd)\b", "", stem, flags=re.I)
    # Remove codec/source tags
    stem = re.sub(
        r"\b(x264|x265|h264|h265|xvid|divx|aac|mp3|hevc|bluray|bdrip|dvdrip|webrip|web-dl|hdtv)\b",
        "",
        stem,
        flags=re.I,
    )
    # Collapse whitespace
    stem = re.sub(r"\s+", " ", stem).strip()
    return stem or filename


def _orientation_from_resolution(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    elif height > width:
        return "portrait"
    return "square"


def _fmt_modified(path: Path) -> str:
    ts = os.path.getmtime(str(path))
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── ffprobe metadata extraction ────────────────────────────────────────────

def _run_ffprobe(path: Path) -> Optional[dict]:
    """Run ffprobe on a file and return parsed JSON, or None on error."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-print_format", "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0:
            return None
        return json.loads(result.stdout)
    except (subprocess.TimeoutExpired, json.JSONDecodeError, FileNotFoundError):
        return None


def _extract_video_metadata(path: Path) -> Optional[dict]:
    """Extract duration, resolution, codec, container from a video file."""
    data = _run_ffprobe(path)
    if not data:
        return None

    # Find the primary video stream
    video_stream = None
    audio_stream = None
    for stream in data.get("streams", []):
        codec_type = stream.get("codec_type", "")
        if codec_type == "video" and video_stream is None:
            video_stream = stream
        elif codec_type == "audio" and audio_stream is None:
            audio_stream = stream

    if not video_stream:
        return None

    width = video_stream.get("width", 0)
    height = video_stream.get("height", 0)
    codec_name = (video_stream.get("codec_name") or "").lower()

    # Try to get duration from stream first, then format
    duration = None
    raw_dur = video_stream.get("duration") or data.get("format", {}).get("duration")
    if raw_dur:
        try:
            duration = float(raw_dur)
        except (ValueError, TypeError):
            pass

    # Handle rotation (common in phone videos)
    rotation = 0
    tags = video_stream.get("tags", {}) or {}
    if "rotate" in tags:
        try:
            rotation = int(tags["rotate"])
        except (ValueError, TypeError):
            pass
    # Also check side_data_list for display matrix rotation
    for sd in video_stream.get("side_data_list", []) or []:
        if sd.get("side_data_type") == "Display Matrix":
            try:
                rotation = -int(sd.get("rotation", 0))
            except (ValueError, TypeError):
                pass

    # If rotated 90/270, swap width/height for orientation
    if abs(rotation) in (90, 270):
        width, height = height, width

    container = Path(path).suffix.lstrip(".").lower()

    # Classify browser native vs needs transcode
    # GIF is special: browser plays it natively as <img> but we want <video>
    # We'll transcode GIF to mp4 for better performance
    is_gif = path.suffix.lower() == ".gif"
    browser_native = (
        not is_gif
        and codec_name in BROWSER_NATIVE_CODECS
        and container in BROWSER_NATIVE_CONTAINERS
    )

    return {
        "duration_seconds": duration,
        "resolution": f"{width}x{height}" if width and height else None,
        "codec": codec_name or None,
        "browser_native": browser_native,
        "orientation": _orientation_from_resolution(width, height) if width and height else None,
    }


# ── Pillow metadata extraction ─────────────────────────────────────────────

def _extract_image_metadata(path: Path) -> Optional[dict]:
    """Extract resolution, orientation, and EXIF DateTimeOriginal from an image."""
    if not PIL_AVAILABLE:
        return None

    ext = path.suffix.lower()
    if ext in (".heic", ".heif") and not HEIF_AVAILABLE:
        return None

    try:
        with Image.open(str(path)) as img:
            width, height = img.size

            # Read EXIF for orientation + capture date
            captured_at = None
            orientation = _orientation_from_resolution(width, height)

            try:
                exif_data = img._getexif()  # type: ignore[attr-defined]
                if exif_data:
                    decoded = {TAGS.get(k, k): v for k, v in exif_data.items()}

                    # Capture datetime
                    dt_str = decoded.get("DateTimeOriginal") or decoded.get("DateTime")
                    if dt_str:
                        try:
                            dt = datetime.strptime(str(dt_str), "%Y:%m:%d %H:%M:%S")
                            captured_at = dt.strftime("%Y-%m-%dT%H:%M:%SZ")
                        except ValueError:
                            pass

                    # EXIF orientation tag (1-8)
                    exif_orient = decoded.get("Orientation", 1)
                    if exif_orient in (5, 6, 7, 8):
                        # Rotated 90/270 — swap for logical orientation
                        width, height = height, width
                        orientation = _orientation_from_resolution(width, height)

            except (AttributeError, Exception):
                pass  # No EXIF, that's fine

            return {
                "resolution": f"{width}x{height}",
                "orientation": orientation,
                "captured_at": captured_at,
            }
    except Exception as e:
        logger.debug("Could not open image %s: %s", path, e)
        return None


# ── Folder upsert ──────────────────────────────────────────────────────────

def _upsert_folder(conn, folder_path: Path, root_path: Path) -> int:
    """
    Ensure a folder row exists for folder_path. Also ensures all parent folders
    up to (but not including) root_path exist. Returns the folder id.
    """
    # Build chain from root → folder
    rel = folder_path.relative_to(root_path)
    parts = list(rel.parts)

    parent_id = None
    current_path = root_path

    for part in parts:
        current_path = current_path / part
        path_str = str(current_path)

        row = conn.execute(
            "SELECT id FROM folders WHERE path = ?", (path_str,)
        ).fetchone()

        if row:
            folder_id = row["id"]
        else:
            cursor = conn.execute(
                """
                INSERT INTO folders (name, path, parent_folder_id)
                VALUES (?, ?, ?)
                """,
                (part, path_str, parent_id),
            )
            folder_id = cursor.lastrowid

        parent_id = folder_id

    return parent_id  # type: ignore[return-value]


# ── Main scan logic ────────────────────────────────────────────────────────

def _collect_media_files(roots: list[Path]) -> list[Path]:
    """Walk roots and collect all media file paths."""
    all_files = []
    all_exts = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS
    for root in roots:
        if not root.exists():
            logger.warning("Media root does not exist, skipping: %s", root)
            continue
        for dirpath, _dirs, files in os.walk(str(root)):
            for fname in files:
                if Path(fname).suffix.lower() in all_exts:
                    all_files.append(Path(dirpath) / fname)
    return all_files


def _get_existing_paths(conn) -> dict[str, dict]:
    """Return a dict of path → {id, file_modified_at, is_active} for all DB rows."""
    rows = conn.execute(
        "SELECT id, path, file_modified_at, is_active FROM media_items"
    ).fetchall()
    return {r["path"]: dict(r) for r in rows}


def run_scan(roots: list[Path] | None = None) -> None:
    """
    Full incremental scan. Safe to call from a background thread.
    Only one scan runs at a time (guarded by _scan_lock check).
    """
    global _scan_state

    with _scan_lock:
        if _scan_state.running:
            logger.info("Scan already running — ignoring duplicate request")
            return
        _scan_state = ScanState(
            running=True,
            started_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )

    if roots is None:
        roots = MEDIA_ROOTS

    logger.info("Starting scan of %d root(s): %s", len(roots), roots)

    try:
        _do_scan(roots)
    except Exception as e:
        logger.exception("Scan crashed: %s", e)
        with _scan_lock:
            _scan_state.errors += 1
            _scan_state.error_log.append(f"Fatal: {e}")
    finally:
        with _scan_lock:
            _scan_state.running = False
            _scan_state.finished_at = datetime.now(timezone.utc).strftime(
                "%Y-%m-%dT%H:%M:%SZ"
            )

    logger.info(
        "Scan complete: %d new, %d updated, %d skipped, %d errors",
        _scan_state.files_new,
        _scan_state.files_updated,
        _scan_state.files_skipped,
        _scan_state.errors,
    )


def _do_scan(roots: list[Path]) -> None:
    global _scan_state

    # Phase 1: collect all file paths (fast)
    logger.info("Collecting file paths...")
    all_files = _collect_media_files(roots)

    with _scan_lock:
        _scan_state.files_total = len(all_files)
    logger.info("Found %d media files", len(all_files))

    # Phase 2: load existing DB entries
    with get_db() as conn:
        existing = _get_existing_paths(conn)

    # Phase 3: mark deleted files inactive
    existing_paths_on_disk = {str(f) for f in all_files}
    paths_to_deactivate = [
        info["id"]
        for path_str, info in existing.items()
        if path_str not in existing_paths_on_disk and info["is_active"]
    ]
    if paths_to_deactivate:
        with get_db() as conn:
            conn.executemany(
                "UPDATE media_items SET is_active = 0 WHERE id = ?",
                [(pid,) for pid in paths_to_deactivate],
            )
        logger.info("Marked %d deleted files as inactive", len(paths_to_deactivate))

    # Phase 4: process each file
    for file_path in all_files:
        with _scan_lock:
            _scan_state.files_scanned += 1

        path_str = str(file_path)
        file_modified = _fmt_modified(file_path)

        # Skip if unchanged
        if path_str in existing:
            db_row = existing[path_str]
            if db_row["file_modified_at"] == file_modified and db_row["is_active"]:
                with _scan_lock:
                    _scan_state.files_skipped += 1
                continue
            # File changed or was inactive — reprocess
            _process_file(file_path, file_modified, existing_id=db_row["id"])
            with _scan_lock:
                _scan_state.files_updated += 1
        else:
            _process_file(file_path, file_modified, existing_id=None)
            with _scan_lock:
                _scan_state.files_new += 1

    # Phase 5: update folder item_counts
    with get_db() as conn:
        conn.execute(
            """
            UPDATE folders SET item_count = (
                SELECT COUNT(*) FROM media_items
                WHERE folder_id = folders.id AND is_active = 1
            )
            """
        )
        # Set cover thumbnails for folders that don't have one
        conn.execute(
            """
            UPDATE folders SET cover_thumbnail_path = (
                SELECT thumbnail_path FROM media_items
                WHERE folder_id = folders.id AND is_active = 1
                  AND thumbnail_path IS NOT NULL
                ORDER BY ROWID ASC LIMIT 1
            )
            WHERE cover_thumbnail_path IS NULL
            """
        )


def _process_file(
    file_path: Path,
    file_modified: str,
    existing_id: Optional[int],
) -> None:
    global _scan_state

    ext = file_path.suffix.lower()

    try:
        file_size = os.path.getsize(str(file_path))
    except OSError as e:
        logger.warning("Cannot stat %s: %s", file_path, e)
        with _scan_lock:
            _scan_state.errors += 1
        return

    # Determine media type
    if ext in VIDEO_EXTENSIONS:
        media_type = "video"
    elif ext in IMAGE_EXTENSIONS:
        media_type = "image"
    else:
        return  # shouldn't happen, but be safe

    # Extract metadata
    meta: dict = {}
    if media_type == "video":
        try:
            raw_meta = _extract_video_metadata(file_path)
            if raw_meta:
                meta = raw_meta
            else:
                logger.warning("ffprobe returned no data for %s", file_path)
        except Exception as e:
            logger.warning("Video metadata error for %s: %s", file_path, e)
            with _scan_lock:
                _scan_state.errors += 1
                _scan_state.error_log.append(f"{file_path.name}: {e}")
    else:
        try:
            raw_meta = _extract_image_metadata(file_path)
            if raw_meta:
                meta = raw_meta
        except Exception as e:
            logger.warning("Image metadata error for %s: %s", file_path, e)
            with _scan_lock:
                _scan_state.errors += 1
                _scan_state.error_log.append(f"{file_path.name}: {e}")

    title = _clean_title(file_path.name)
    folder_path = file_path.parent

    try:
        with get_db() as conn:
            # Determine root for this file
            root = _find_root(file_path)
            folder_id = _upsert_folder(conn, folder_path, root)

            if existing_id is None:
                conn.execute(
                    """
                    INSERT INTO media_items (
                        folder_id, media_type, filename, path, title,
                        duration_seconds, codec, browser_native,
                        resolution, orientation, file_size_bytes,
                        file_modified_at, captured_at, is_active
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                    """,
                    (
                        folder_id,
                        media_type,
                        file_path.name,
                        str(file_path),
                        title,
                        meta.get("duration_seconds"),
                        meta.get("codec"),
                        1 if meta.get("browser_native", True) else 0,
                        meta.get("resolution"),
                        meta.get("orientation"),
                        file_size,
                        file_modified,
                        meta.get("captured_at"),
                    ),
                )
            else:
                conn.execute(
                    """
                    UPDATE media_items SET
                        folder_id = ?, title = ?, duration_seconds = ?,
                        codec = ?, browser_native = ?, resolution = ?,
                        orientation = ?, file_size_bytes = ?,
                        file_modified_at = ?, captured_at = ?, is_active = 1
                    WHERE id = ?
                    """,
                    (
                        folder_id,
                        title,
                        meta.get("duration_seconds"),
                        meta.get("codec"),
                        1 if meta.get("browser_native", True) else 0,
                        meta.get("resolution"),
                        meta.get("orientation"),
                        file_size,
                        file_modified,
                        meta.get("captured_at"),
                        existing_id,
                    ),
                )
    except Exception as e:
        logger.error("DB error for %s: %s", file_path, e)
        with _scan_lock:
            _scan_state.errors += 1
            _scan_state.error_log.append(f"{file_path.name}: DB error: {e}")


def _find_root(file_path: Path) -> Path:
    """Find which MEDIA_ROOT contains this file."""
    for root in MEDIA_ROOTS:
        try:
            file_path.relative_to(root)
            return root
        except ValueError:
            continue
    # Fallback: use the file's parent as the root
    return file_path.parent
