"""
Lazy thumbnail generation, background transcoding, and caching.

Video thumbnails: ffmpeg frame extraction at ~10% into the video with auto-scaling.
Image thumbnails: Pillow resize to THUMBNAIL_WIDTH px.
HEIC conversion: pillow-heif -> JPEG (cached).
Video transcoding: High-compatibility H.264/AAC MP4 conversion with odd-dimension scaling,
atomic tempfile replacement, and thread-safe in-flight locks.

All functions are idempotent - they check the disk cache before doing work.
Thumbnail and transcoded paths are keyed by media_item id to avoid filename collisions.
"""
from __future__ import annotations

import logging
import os
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Optional

from app.config import THUMBNAIL_DIR, TRANSCODED_DIR, THUMBNAIL_WIDTH

logger = logging.getLogger("localfeed.thumbnails")

# Check HEIC availability
try:
    import pillow_heif  # noqa: F401
    pillow_heif.register_heif_opener()
    HEIF_AVAILABLE = True
except ImportError:
    HEIF_AVAILABLE = False

try:
    from PIL import Image
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False

# Background transcoding thread pool and job tracker
_transcode_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="transcode_worker")
_transcode_locks: dict[int, threading.Lock] = {}
_in_flight_transcodes: set[int] = set()
_transcode_meta_lock = threading.Lock()


def get_video_thumbnail_path(item_id: int) -> Path:
    return THUMBNAIL_DIR / f"video_{item_id}.jpg"


def get_image_thumbnail_path(item_id: int) -> Path:
    return THUMBNAIL_DIR / f"image_{item_id}.jpg"


def get_heic_converted_path(item_id: int) -> Path:
    return TRANSCODED_DIR / f"heic_{item_id}.jpg"


def get_transcoded_path(item_id: int) -> Path:
    return TRANSCODED_DIR / f"video_{item_id}.mp4"


def get_transcoded_temp_path(item_id: int) -> Path:
    return TRANSCODED_DIR / f"video_{item_id}.tmp.mp4"


# ── Video thumbnail ────────────────────────────────────────────────────────

def generate_video_thumbnail(
    item_id: int,
    file_path: str,
    duration_seconds: Optional[float],
) -> Optional[Path]:
    """
    Generate a thumbnail for a video by extracting a frame at ~10% duration.
    Uses odd-dimension safe scaling and pixel format conversion.
    Returns the thumbnail path on success, None on failure.
    """
    out_path = get_video_thumbnail_path(item_id)
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path

    # Calculate seek time (10% into video, minimum 1s, maximum 30s)
    seek = 1.0
    if duration_seconds and duration_seconds > 0:
        seek = min(max(duration_seconds * 0.1, 1.0), 30.0)

    # Scale filter ensuring width is THUMBNAIL_WIDTH and height is rounded to an even integer
    scale_filter = f"scale={THUMBNAIL_WIDTH}:-2:flags=fast_bilinear,format=yuv420p"

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-fflags", "+genpts+discardcorrupt",
                "-err_detect", "ignore_err",
                "-ss", str(seek),
                "-i", file_path,
                "-vframes", "1",
                "-vf", scale_filter,
                "-q:v", "3",
                str(out_path),
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
            # Fallback: try from beginning without seeking
            result2 = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-fflags", "+genpts+discardcorrupt",
                    "-err_detect", "ignore_err",
                    "-i", file_path,
                    "-vframes", "1",
                    "-vf", scale_filter,
                    "-q:v", "3",
                    str(out_path),
                ],
                capture_output=True,
                timeout=60,
            )
            if result2.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
                logger.warning("ffmpeg thumbnail failed for item %d: %s", item_id, file_path)
                out_path.unlink(missing_ok=True)
                return None
        return out_path
    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg thumbnail timed out for item %d", item_id)
        out_path.unlink(missing_ok=True)
        return None
    except FileNotFoundError:
        logger.error("ffmpeg not found - cannot generate video thumbnails")
        return None
    except Exception as e:
        logger.warning("Thumbnail error for item %d: %s", item_id, e)
        out_path.unlink(missing_ok=True)
        return None


# ── Image thumbnail ────────────────────────────────────────────────────────

def generate_image_thumbnail(item_id: int, file_path: str) -> Optional[Path]:
    """
    Generate a thumbnail for an image via Pillow resize.
    Returns the thumbnail path on success, None on failure.
    """
    if not PIL_AVAILABLE:
        return None

    out_path = get_image_thumbnail_path(item_id)
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path

    path = Path(file_path)
    ext = path.suffix.lower()

    if ext in (".heic", ".heif") and not HEIF_AVAILABLE:
        logger.debug("HEIC support unavailable for item %d", item_id)
        return None

    try:
        with Image.open(file_path) as img:
            img = img.convert("RGB")
            # Respect EXIF orientation
            try:
                img = _apply_exif_orientation(img)
            except Exception:
                pass
            # Resize maintaining aspect ratio
            w_orig, h_orig = img.size
            if w_orig > THUMBNAIL_WIDTH:
                h_new = max(1, int(h_orig * THUMBNAIL_WIDTH / w_orig))
                img = img.resize((THUMBNAIL_WIDTH, h_new), Image.LANCZOS)
            img.save(str(out_path), "JPEG", quality=85, optimize=True)
        return out_path
    except Exception as e:
        logger.warning("Image thumbnail error for item %d (%s): %s", item_id, file_path, e)
        out_path.unlink(missing_ok=True)
        return None


def _apply_exif_orientation(img: "Image.Image") -> "Image.Image":
    from PIL import ImageOps
    return ImageOps.exif_transpose(img)


# ── HEIC full-resolution conversion ───────────────────────────────────────

def get_or_convert_heic(item_id: int, file_path: str) -> Optional[Path]:
    """
    Convert a HEIC file to JPEG (cached). Returns JPEG path on success, None on failure.
    """
    if not HEIF_AVAILABLE or not PIL_AVAILABLE:
        return None

    out_path = get_heic_converted_path(item_id)
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path

    try:
        with Image.open(file_path) as img:
            img = img.convert("RGB")
            try:
                img = _apply_exif_orientation(img)
            except Exception:
                pass
            img.save(str(out_path), "JPEG", quality=92, optimize=True)
        return out_path
    except Exception as e:
        logger.warning("HEIC conversion failed for item %d: %s", item_id, e)
        out_path.unlink(missing_ok=True)
        return None


# ── Video transcoding (H.264/AAC MP4 with atomic tempfile & locks) ─────────

def transcode_video(item_id: int, file_path: str) -> Optional[Path]:
    """
    Transcode a non-browser-native video to H.264/AAC in an MP4 container.
    Guarantees:
      - Odd dimensions are rounded with scale=trunc(iw/2)*2:trunc(ih/2)*2
      - Pixel format is forced to yuv420p for all browsers
      - Audio is resampled to 44.1kHz stereo AAC
      - Writing is atomic (temp file -> target path)
      - In-flight execution is locked per item_id to avoid duplicate processes
    """
    out_path = get_transcoded_path(item_id)
    if out_path.exists() and out_path.stat().st_size > 0:
        return out_path

    # Synchronize per item_id so concurrent requests wait on the same job
    with _transcode_meta_lock:
        if item_id not in _transcode_locks:
            _transcode_locks[item_id] = threading.Lock()
        lock = _transcode_locks[item_id]
        _in_flight_transcodes.add(item_id)

    with lock:
        # Re-check after acquiring lock
        if out_path.exists() and out_path.stat().st_size > 0:
            with _transcode_meta_lock:
                _in_flight_transcodes.discard(item_id)
            return out_path

        tmp_path = get_transcoded_temp_path(item_id)
        tmp_path.unlink(missing_ok=True)

        try:
            logger.info("Starting transcode for item %d: %s", item_id, file_path)
            cmd = [
                "ffmpeg", "-y",
                "-fflags", "+genpts+discardcorrupt",
                "-err_detect", "ignore_err",
                "-i", file_path,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-pix_fmt", "yuv420p",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-c:a", "aac",
                "-b:a", "128k",
                "-ar", "44100",
                "-ac", "2",
                "-sn",
                "-dn",
                "-max_muxing_queue_size", "1024",
                "-movflags", "+faststart",
                str(tmp_path),
            ]
            result = subprocess.run(
                cmd,
                capture_output=True,
                timeout=3600,  # 1 hour max
            )
            if result.returncode != 0 or not tmp_path.exists() or tmp_path.stat().st_size == 0:
                logger.error(
                    "Transcode failed for item %d: %s",
                    item_id,
                    result.stderr.decode(errors="replace")[-500:],
                )
                tmp_path.unlink(missing_ok=True)
                return None

            # Atomic move to final target path
            os.replace(str(tmp_path), str(out_path))
            logger.info("Transcode completed for item %d: %s", item_id, out_path)
            return out_path
        except subprocess.TimeoutExpired:
            logger.error("Transcode timed out for item %d", item_id)
            tmp_path.unlink(missing_ok=True)
            return None
        except FileNotFoundError:
            logger.error("ffmpeg not found - cannot transcode video")
            return None
        except Exception as e:
            logger.error("Transcode error for item %d: %s", item_id, e)
            tmp_path.unlink(missing_ok=True)
            return None
        finally:
            with _transcode_meta_lock:
                _in_flight_transcodes.discard(item_id)


def queue_background_transcode(item_id: int, file_path: str) -> None:
    """
    Queue an asynchronous background transcode task without blocking the HTTP response.
    """
    out_path = get_transcoded_path(item_id)
    if out_path.exists() and out_path.stat().st_size > 0:
        return

    with _transcode_meta_lock:
        if item_id in _in_flight_transcodes:
            return  # Already in progress

    _transcode_executor.submit(transcode_video, item_id, file_path)


def get_transcode_status(item_id: int) -> dict:
    """
    Check the current transcode state for an item:
    Returns dict: {"id": item_id, "status": "ready" | "transcoding" | "idle"}
    """
    out_path = get_transcoded_path(item_id)
    if out_path.exists() and out_path.stat().st_size > 0:
        return {"id": item_id, "status": "ready"}

    with _transcode_meta_lock:
        if item_id in _in_flight_transcodes:
            return {"id": item_id, "status": "transcoding"}

    return {"id": item_id, "status": "idle"}


# ── DB thumbnail path updater ──────────────────────────────────────────────

def update_thumbnail_in_db(conn, item_id: int, thumbnail_path: Path) -> None:
    conn.execute(
        "UPDATE media_items SET thumbnail_path = ? WHERE id = ?",
        (str(thumbnail_path), item_id),
    )
