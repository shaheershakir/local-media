"""
Filesystem scanner — walks MEDIA_ROOTS, extracts metadata via ffprobe / Pillow,
and upserts into SQLite. Thumbnails are NOT generated here (lazy, on-demand).

Key design decisions:
- Incremental: diffs by (path, file_modified_at, file_size_bytes) — skips unchanged files.
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
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from app import config
from app.config import (
    BROWSER_NATIVE_AUDIO_CODECS,
    BROWSER_NATIVE_CODECS,
    BROWSER_NATIVE_CONTAINERS,
    IMAGE_EXTENSIONS,
    MEDIA_ROOTS,
    SCAN_DB_BATCH_SIZE,
    SCAN_METADATA_WORKERS,
    VIDEO_EXTENSIONS,
)
from app.db import get_db, create_schema

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


@dataclass(frozen=True)
class MediaCandidate:
    path: Path
    file_size: int
    file_modified: str


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
    """Make a human-readable title from a raw filename, preserving file extension."""
    path = Path(filename)
    stem = path.stem
    ext = path.suffix.lower()
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
    if stem:
        return f"{stem}{ext}" if ext else stem
    return filename


def _orientation_from_resolution(width: int, height: int) -> str:
    if width > height:
        return "landscape"
    elif height > width:
        return "portrait"
    return "square"


def _fmt_modified(stat_result: os.stat_result) -> str:
    ts = stat_result.st_mtime
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── ffprobe metadata extraction ────────────────────────────────────────────

def _run_ffprobe(path: Path) -> Optional[dict]:
    """Run ffprobe on a file and return parsed JSON, or None on error."""
    try:
        result = subprocess.run(
            [
                "ffprobe", "-v", "quiet",
                "-analyzeduration", "2000000",
                "-probesize", "2000000",
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


def _parse_duration_value(val: Any) -> Optional[float]:
    """Parse duration from float, int, or timestamp string (e.g. HH:MM:SS.mmm)."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val) if val > 0 else None
    s = str(val).strip()
    if not s or s.upper() == "N/A":
        return None
    try:
        f = float(s)
        return f if f > 0 else None
    except ValueError:
        pass
    parts = s.split(":")
    if len(parts) in (2, 3):
        try:
            if len(parts) == 3:
                h, m, sec = float(parts[0]), float(parts[1]), float(parts[2])
                dur = h * 3600 + m * 60 + sec
            else:
                m, sec = float(parts[0]), float(parts[1])
                dur = m * 60 + sec
            return dur if dur > 0 else None
        except ValueError:
            pass
    return None


def _fast_probe_duration(path: Path) -> Optional[float]:
    """Fallback fast duration probe via ffmpeg -i when ffprobe headers lack duration."""
    try:
        proc = subprocess.run(
            ["ffmpeg", "-i", str(path)],
            capture_output=True,
            timeout=10,
        )
        stderr_text = proc.stderr.decode(errors="replace")
        match = re.search(r"Duration:\s*(\d{2}:\d{2}:\d{2}(?:\.\d+)?)", stderr_text)
        if match:
            return _parse_duration_value(match.group(1))
    except Exception:
        pass
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

    # Try to get duration from stream, format, tags, or fast probe
    duration = (
        _parse_duration_value(video_stream.get("duration"))
        or _parse_duration_value(data.get("format", {}).get("duration"))
        or _parse_duration_value(video_stream.get("tags", {}).get("DURATION"))
        or _parse_duration_value(video_stream.get("tags", {}).get("DURATION-eng"))
        or _parse_duration_value(video_stream.get("tags", {}).get("duration"))
        or _parse_duration_value(data.get("format", {}).get("tags", {}).get("DURATION"))
        or _parse_duration_value(data.get("format", {}).get("tags", {}).get("DURATION-eng"))
        or (audio_stream and _parse_duration_value(audio_stream.get("duration")))
    )
    if duration is None or duration <= 0:
        duration = _fast_probe_duration(path)

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

    audio_codec_name = (audio_stream.get("codec_name") or "").lower() if audio_stream else ""

    container = Path(path).suffix.lstrip(".").lower()

    # Classify browser native vs needs transcode
    # GIF is special: browser plays it natively as <img> but we want <video>
    # We'll transcode GIF to mp4 for better performance
    is_gif = path.suffix.lower() == ".gif"
    browser_native = (
        not is_gif
        and codec_name in BROWSER_NATIVE_CODECS
        and container in BROWSER_NATIVE_CONTAINERS
        and audio_codec_name in BROWSER_NATIVE_AUDIO_CODECS
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

def _upsert_folder(
    conn,
    folder_path: Path,
    root_path: Path,
    folder_cache: dict[str, int],
) -> int:
    """
    Ensure a folder row exists for folder_path and all parent folders
    up to root_path. Returns the folder id.
    """
    # 1. Ensure root source folder exists
    root_str = str(root_path)
    cached_root_id = folder_cache.get(root_str)
    if cached_root_id is not None:
        root_id = cached_root_id
    else:
        row = conn.execute(
            "SELECT id FROM folders WHERE path = ?", (root_str,)
        ).fetchone()
        if row:
            root_id = row["id"]
        else:
            cursor = conn.execute(
                """
                INSERT INTO folders (name, path, parent_folder_id)
                VALUES (?, ?, NULL)
                """,
                (root_path.name or str(root_path), root_str),
            )
            root_id = cursor.lastrowid
        folder_cache[root_str] = root_id

    # If the media file is directly in the root path, return root_id
    try:
        rel = folder_path.relative_to(root_path)
        parts = list(rel.parts)
    except ValueError:
        parts = []

    if not parts:
        return root_id

    parent_id = root_id
    current_path = root_path
    for part in parts:
        current_path = current_path / part
        path_str = str(current_path)

        cached_id = folder_cache.get(path_str)
        if cached_id is not None:
            parent_id = cached_id
            continue

        row = conn.execute(
            "SELECT id, parent_folder_id FROM folders WHERE path = ?", (path_str,)
        ).fetchone()

        if row:
            folder_id = row["id"]
            if row["parent_folder_id"] != parent_id:
                conn.execute(
                    "UPDATE folders SET parent_folder_id = ? WHERE id = ?",
                    (parent_id, folder_id),
                )
        else:
            cursor = conn.execute(
                """
                INSERT INTO folders (name, path, parent_folder_id)
                VALUES (?, ?, ?)
                """,
                (part, path_str, parent_id),
            )
            folder_id = cursor.lastrowid

        folder_cache[path_str] = folder_id
        parent_id = folder_id

    return parent_id


# ── Main scan logic ────────────────────────────────────────────────────────

def _collect_media_files(roots: list[Path]) -> list[MediaCandidate]:
    """Collect media files with os.scandir and reuse discovery stat data."""
    all_files: list[MediaCandidate] = []
    all_exts = VIDEO_EXTENSIONS | IMAGE_EXTENSIONS

    def walk(directory: Path):
        try:
            entries = os.scandir(str(directory))
        except OSError as e:
            logger.warning("Cannot scan directory %s: %s", directory, e)
            return

        with entries:
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        yield from walk(Path(entry.path))
                    elif entry.is_file(follow_symlinks=False):
                        if Path(entry.name).suffix.lower() not in all_exts:
                            continue
                        stat_result = entry.stat(follow_symlinks=False)
                        yield MediaCandidate(
                            path=Path(entry.path),
                            file_size=stat_result.st_size,
                            file_modified=_fmt_modified(stat_result),
                        )
                except OSError as e:
                    logger.debug("Cannot inspect %s: %s", entry.path, e)

    for root in roots:
        if not root.exists():
            logger.warning("Media root does not exist, skipping: %s", root)
            continue
        all_files.extend(walk(root))
    return all_files


def _get_existing_paths(conn) -> dict[str, dict]:
    """Return a dict of path → {id, file_modified_at, is_active} for all DB rows."""
    rows = conn.execute(
        "SELECT id, path, file_modified_at, file_size_bytes, is_active FROM media_items"
    ).fetchall()
    return {r["path"]: dict(r) for r in rows}


_rescan_requested: bool = False


def _update_folder_aggregates(conn) -> None:
    """Update item_count and cover thumbnails for folders."""
    try:
        folder_counts = conn.execute(
            """
            WITH RECURSIVE subfolder_tree(root_id, child_id) AS (
                SELECT id, id FROM folders
                UNION ALL
                SELECT s.root_id, f.id FROM folders f
                JOIN subfolder_tree s ON f.parent_folder_id = s.child_id
            )
            SELECT s.root_id, COUNT(m.id) as total_items
            FROM subfolder_tree s
            LEFT JOIN media_items m ON m.folder_id = s.child_id AND m.is_active = 1
            GROUP BY s.root_id
            """
        ).fetchall()

        for row in folder_counts:
            conn.execute(
                "UPDATE folders SET item_count = ? WHERE id = ?",
                (row["total_items"], row["root_id"]),
            )

        conn.execute(
            """
            WITH RECURSIVE subfolder_tree(root_id, child_id) AS (
                SELECT id, id FROM folders
                UNION ALL
                SELECT s.root_id, f.id FROM folders f
                JOIN subfolder_tree s ON f.parent_folder_id = s.child_id
            )
            UPDATE folders SET cover_thumbnail_path = (
                SELECT m.thumbnail_path FROM subfolder_tree s
                JOIN media_items m ON m.folder_id = s.child_id AND m.is_active = 1
                WHERE s.root_id = folders.id AND m.thumbnail_path IS NOT NULL
                ORDER BY m.id ASC LIMIT 1
            )
            WHERE cover_thumbnail_path IS NULL
            """
        )
    except Exception as e:
        logger.warning("Could not update folder aggregates: %s", e)


def run_scan(roots: list[Path] | None = None) -> None:
    """
    Full incremental scan. Safe to call from a background thread.
    If another scan is requested while a scan is currently running,
    queues a follow-up scan pass so all roots are fully processed.
    """
    global _scan_state, _rescan_requested

    with _scan_lock:
        if _scan_state.running:
            _rescan_requested = True
            logger.info("Scan already running — queued follow-up re-scan request")
            return
        _scan_state = ScanState(
            running=True,
            started_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        )
        _rescan_requested = False

    while True:
        if roots is None:
            scan_roots = list(config.MEDIA_ROOTS)
        else:
            scan_roots = list(roots)

        logger.info("Starting scan of %d root(s): %s", len(scan_roots), scan_roots)

        # Ensure schema exists — handles the case where the DB was deleted while
        # the server is running (create_schema uses IF NOT EXISTS so it's safe).
        try:
            create_schema()
        except Exception as e:
            logger.error("Failed to initialise database schema: %s", e)
            with _scan_lock:
                _scan_state.running = False
                _scan_state.finished_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            return

        try:
            _do_scan(scan_roots)
        except Exception as e:
            logger.exception("Scan crashed: %s", e)
            with _scan_lock:
                _scan_state.errors += 1
                _scan_state.error_log.append(f"Fatal: {e}")

        # Check if another scan pass was requested while this pass was executing
        with _scan_lock:
            if _rescan_requested:
                _rescan_requested = False
                roots = None  # Reload latest config.MEDIA_ROOTS
                logger.info("Executing queued follow-up re-scan pass")
                continue
            else:
                _scan_state.running = False
                _scan_state.finished_at = datetime.now(timezone.utc).strftime(
                    "%Y-%m-%dT%H:%M:%SZ"
                )
                break

    logger.info(
        "Scan complete: %d new, %d updated, %d skipped, %d errors",
        _scan_state.files_new,
        _scan_state.files_updated,
        _scan_state.files_skipped,
        _scan_state.errors,
    )


def _do_scan(roots: list[Path]) -> None:
    global _scan_state

    # Phase 1: discover files and retain stat data so each candidate is not
    # stat'ed again later.
    logger.info("Collecting file paths...")
    all_files = _collect_media_files(roots)

    with _scan_lock:
        _scan_state.files_total = len(all_files)
    logger.info("Found %d media files", len(all_files))

    # Keep one SQLite writer for the scan. Metadata workers never access the
    # database, which avoids lock contention while eliminating connection and
    # commit overhead for every file.
    with get_db() as conn:
        existing = _get_existing_paths(conn)

        # Phase 2: mark deleted files inactive.
        existing_paths_on_disk = {str(candidate.path) for candidate in all_files}
        paths_to_deactivate = [
            info["id"]
            for path_str, info in existing.items()
            if path_str not in existing_paths_on_disk and info["is_active"]
        ]
        if paths_to_deactivate:
            conn.executemany(
                "UPDATE media_items SET is_active = 0 WHERE id = ?",
                [(pid,) for pid in paths_to_deactivate],
            )
            logger.info("Marked %d deleted files as inactive", len(paths_to_deactivate))

        # Phase 3: compare cheap metadata first; only changed files enter the
        # worker pool. Size catches replacements that retain the same mtime.
        changed: list[tuple[MediaCandidate, Optional[int]]] = []
        for candidate in all_files:
            db_row = existing.get(str(candidate.path))
            if (
                db_row
                and db_row["is_active"]
                and db_row["file_modified_at"] == candidate.file_modified
                and db_row["file_size_bytes"] == candidate.file_size
            ):
                with _scan_lock:
                    _scan_state.files_scanned += 1
                    _scan_state.files_skipped += 1
                continue
            changed.append((candidate, db_row["id"] if db_row else None))

        folder_cache: dict[str, int] = {}
        writes_since_commit = 0
        worker_count = max(1, SCAN_METADATA_WORKERS)
        with ThreadPoolExecutor(
            max_workers=worker_count,
            thread_name_prefix="localfeed-meta",
        ) as executor:
            futures = {
                executor.submit(_extract_file_metadata, candidate.path): (
                    candidate,
                    existing_id,
                )
                for candidate, existing_id in changed
            }
            for future in as_completed(futures):
                candidate, existing_id = futures[future]
                meta, metadata_error = future.result()
                if metadata_error:
                    with _scan_lock:
                        _scan_state.errors += 1
                        _scan_state.error_log.append(
                            f"{candidate.path.name}: {metadata_error}"
                        )

                _process_file(
                    conn,
                    candidate,
                    meta,
                    existing_id,
                    folder_cache,
                    roots,
                )
                with _scan_lock:
                    _scan_state.files_scanned += 1
                    if existing_id is None:
                        _scan_state.files_new += 1
                    else:
                        _scan_state.files_updated += 1

                writes_since_commit += 1
                if writes_since_commit >= max(1, SCAN_DB_BATCH_SIZE):
                    conn.commit()
                    writes_since_commit = 0

        # Phase 4: final folder aggregates, cover thumbnails, and cache invalidation.
        _update_folder_aggregates(conn)
        conn.commit()

        try:
            from app.routers.feed import invalidate_id_cache
            invalidate_id_cache()
        except Exception:
            pass


def _extract_file_metadata(path: Path) -> tuple[dict, Optional[str]]:
    """Extract metadata without touching SQLite, suitable for worker threads."""
    media_type = "video" if path.suffix.lower() in VIDEO_EXTENSIONS else "image"
    try:
        raw_meta = (
            _extract_video_metadata(path)
            if media_type == "video"
            else _extract_image_metadata(path)
        )
        if raw_meta:
            return raw_meta, None
        return {}, f"metadata unavailable for {path.name}"
    except Exception as e:
        logger.warning("Metadata error for %s: %s", path, e)
        return {}, str(e)


def _process_file(
    conn,
    candidate: MediaCandidate,
    meta: dict,
    existing_id: Optional[int],
    folder_cache: dict[str, int],
    roots: list[Path],
) -> None:
    file_path = candidate.path
    ext = file_path.suffix.lower()

    # Determine media type
    if ext in VIDEO_EXTENSIONS:
        media_type = "video"
    elif ext in IMAGE_EXTENSIONS:
        media_type = "image"
    else:
        return  # shouldn't happen, but be safe

    title = _clean_title(file_path.name)
    folder_path = file_path.parent

    try:
        root = _find_root(file_path, roots)
        folder_id = _upsert_folder(conn, folder_path, root, folder_cache)

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
                    candidate.file_size,
                    candidate.file_modified,
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
                    candidate.file_size,
                    candidate.file_modified,
                    meta.get("captured_at"),
                    existing_id,
                ),
            )
    except Exception as e:
        logger.error("DB error for %s: %s", file_path, e)
        with _scan_lock:
            _scan_state.errors += 1
            _scan_state.error_log.append(f"{file_path.name}: DB error: {e}")


def _find_root(file_path: Path, roots: list[Path]) -> Path:
    """Find which MEDIA_ROOT contains this file."""
    matching_roots = []
    for root in roots:
        try:
            file_path.relative_to(root)
            matching_roots.append(root)
        except ValueError:
            continue
    if matching_roots:
        return max(matching_roots, key=lambda root: len(root.parts))
    # Fallback: use the file's parent as the root
    return file_path.parent
