"""
Lazy thumbnail generation and caching.

Video thumbnails: ffmpeg frame extraction at ~10% into the video.
Image thumbnails: Pillow resize to THUMBNAIL_WIDTH px.
HEIC conversion: pillow-heif → JPEG (cached).

All functions are idempotent — they check the disk cache before doing work.
Thumbnail paths are keyed by media_item id to avoid filename collisions.
"""
from __future__ import annotations

import logging
import os
import subprocess
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


def get_video_thumbnail_path(item_id: int) -> Path:
    return THUMBNAIL_DIR / f"video_{item_id}.jpg"


def get_image_thumbnail_path(item_id: int) -> Path:
    return THUMBNAIL_DIR / f"image_{item_id}.jpg"


def get_heic_converted_path(item_id: int) -> Path:
    return TRANSCODED_DIR / f"heic_{item_id}.jpg"


def get_transcoded_path(item_id: int) -> Path:
    return TRANSCODED_DIR / f"video_{item_id}.mp4"


# ── Video thumbnail ────────────────────────────────────────────────────────

def generate_video_thumbnail(
    item_id: int,
    file_path: str,
    duration_seconds: Optional[float],
) -> Optional[Path]:
    """
    Generate a thumbnail for a video by extracting a frame at ~10% duration.
    Returns the thumbnail path on success, None on failure.
    """
    out_path = get_video_thumbnail_path(item_id)
    if out_path.exists():
        return out_path

    # Calculate seek time (10% into video, minimum 1s, maximum 30s)
    seek = 1.0
    if duration_seconds and duration_seconds > 0:
        seek = min(max(duration_seconds * 0.1, 1.0), 30.0)

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-ss", str(seek),
                "-i", file_path,
                "-vframes", "1",
                "-vf", f"scale={THUMBNAIL_WIDTH}:-2",
                "-q:v", "3",
                str(out_path),
            ],
            capture_output=True,
            timeout=60,
        )
        if result.returncode != 0 or not out_path.exists():
            # Try from beginning if seek failed
            result2 = subprocess.run(
                [
                    "ffmpeg", "-y",
                    "-i", file_path,
                    "-vframes", "1",
                    "-vf", f"scale={THUMBNAIL_WIDTH}:-2",
                    "-q:v", "3",
                    str(out_path),
                ],
                capture_output=True,
                timeout=60,
            )
            if result2.returncode != 0 or not out_path.exists():
                logger.warning("ffmpeg thumbnail failed for item %d: %s", item_id, file_path)
                return None
        return out_path
    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg thumbnail timed out for item %d", item_id)
        out_path.unlink(missing_ok=True)
        return None
    except FileNotFoundError:
        logger.error("ffmpeg not found — cannot generate video thumbnails")
        return None
    except Exception as e:
        logger.warning("Thumbnail error for item %d: %s", item_id, e)
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
    if out_path.exists():
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
                h_new = int(h_orig * THUMBNAIL_WIDTH / w_orig)
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
    if out_path.exists():
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
        return None


# ── On-the-fly video transcoding ──────────────────────────────────────────

def transcode_video(item_id: int, file_path: str) -> Optional[Path]:
    """
    Transcode a non-browser-native video to H.264/AAC in an fMP4 container.
    Result is cached to disk. Returns the transcoded path on success.

    NOTE: This is a blocking call that can take minutes for long files.
    The stream endpoint calls this lazily and caches the result.
    Seeking on transcoded files restarts ffmpeg from a keyframe — known limitation.
    """
    out_path = get_transcoded_path(item_id)
    if out_path.exists():
        return out_path

    try:
        result = subprocess.run(
            [
                "ffmpeg", "-y",
                "-i", file_path,
                "-c:v", "libx264",
                "-preset", "fast",
                "-crf", "23",
                "-c:a", "aac",
                "-b:a", "128k",
                "-movflags", "+faststart",
                str(out_path),
            ],
            capture_output=True,
            timeout=3600,  # 1 hour max for very long files
        )
        if result.returncode != 0 or not out_path.exists():
            logger.error(
                "Transcode failed for item %d: %s",
                item_id,
                result.stderr.decode(errors="replace")[-500:],
            )
            out_path.unlink(missing_ok=True)
            return None
        return out_path
    except subprocess.TimeoutExpired:
        logger.error("Transcode timed out for item %d", item_id)
        out_path.unlink(missing_ok=True)
        return None
    except FileNotFoundError:
        logger.error("ffmpeg not found — cannot transcode video")
        return None
    except Exception as e:
        logger.error("Transcode error for item %d: %s", item_id, e)
        return None


# ── DB thumbnail path updater ──────────────────────────────────────────────

def update_thumbnail_in_db(conn, item_id: int, thumbnail_path: Path) -> None:
    conn.execute(
        "UPDATE media_items SET thumbnail_path = ? WHERE id = ?",
        (str(thumbnail_path), item_id),
    )
