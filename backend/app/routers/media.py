"""
Media router — list, filter, stream, and serve media items.

GET   /api/media                   — paginated list with filters
GET   /api/media/{id}              — single item detail
PATCH /api/media/{id}              — update is_favorite or title
GET   /api/media/{id}/thumbnail    — serve thumbnail (lazy generate if missing)
GET   /api/media/{id}/stream       — stream video (Range request support + transcode)
GET   /api/media/{id}/full         — serve full-resolution image (HEIC→JPEG if needed)
"""
from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Iterator, Optional

import aiofiles
from fastapi import APIRouter, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from app.db import get_db
from app.thumbnails import (
    generate_image_thumbnail,
    generate_video_thumbnail,
    get_heic_converted_path,
    get_or_convert_heic,
    get_transcoded_path,
    transcode_video,
    update_thumbnail_in_db,
)

router = APIRouter(prefix="/api/media", tags=["media"])

# Chunk size for streaming (256 KB)
CHUNK_SIZE = 256 * 1024


# ── List / filter ─────────────────────────────────────────────────────────

@router.get("")
def list_media(
    sort: str = Query("newest"),
    media_type: Optional[str] = Query(None),
    folder_id: Optional[int] = Query(None),
    q: Optional[str] = Query(None),
    favorites_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(30, ge=1, le=100),
):
    """Paginated media list with filtering and sorting."""
    conditions = ["m.is_active = 1"]
    params: list = []

    if media_type in ("video", "image"):
        conditions.append("m.media_type = ?")
        params.append(media_type)

    if folder_id is not None:
        conditions.append("""
            m.folder_id IN (
                WITH RECURSIVE subfolder_ids(id) AS (
                    SELECT ?
                    UNION ALL
                    SELECT f.id FROM folders f
                    JOIN subfolder_ids s ON f.parent_folder_id = s.id
                )
                SELECT id FROM subfolder_ids
            )
        """)
        params.append(folder_id)

    if favorites_only:
        conditions.append("m.is_favorite = 1")

    if q:
        like = f"%{q}%"
        conditions.append("(m.title LIKE ? OR m.filename LIKE ? OR f.name LIKE ?)")
        params.extend([like, like, like])

    where = " AND ".join(conditions)

    order_clause = {
        "newest": "m.file_modified_at DESC",
        "oldest": "m.file_modified_at ASC",
        "duration": "m.duration_seconds DESC NULLS LAST",
        "favorites": "m.is_favorite DESC, m.file_modified_at DESC",
        "random": "RANDOM()",
        "name": "m.title ASC",
    }.get(sort, "m.file_modified_at DESC")

    offset = (page - 1) * page_size

    with get_db() as conn:
        total = conn.execute(
            f"""
            SELECT COUNT(*) FROM media_items m
            JOIN folders f ON m.folder_id = f.id
            WHERE {where}
            """,
            params,
        ).fetchone()[0]

        rows = conn.execute(
            f"""
            SELECT m.*, f.name as folder_name, f.display_name as folder_display_name
            FROM media_items m
            JOIN folders f ON m.folder_id = f.id
            WHERE {where}
            ORDER BY {order_clause}
            LIMIT ? OFFSET ?
            """,
            params + [page_size, offset],
        ).fetchall()

    items = []
    for r in rows:
        item = dict(r)
        item["folder_label"] = item.get("folder_display_name") or item.get("folder_name")
        items.append(item)

    return {
        "items": items,
        "total": total,
        "page": page,
        "page_size": page_size,
        "pages": max(1, (total + page_size - 1) // page_size),
    }


@router.get("/{item_id}")
def get_media_item(item_id: int):
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT m.*, f.name as folder_name, f.display_name as folder_display_name
            FROM media_items m
            JOIN folders f ON m.folder_id = f.id
            WHERE m.id = ? AND m.is_active = 1
            """,
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media item not found")
    item = dict(row)
    item["folder_label"] = item.get("folder_display_name") or item.get("folder_name")
    return item


class MediaPatch(BaseModel):
    is_favorite: Optional[bool] = None
    title: Optional[str] = None


@router.patch("/{item_id}")
def update_media_item(item_id: int, patch: MediaPatch):
    with get_db() as conn:
        row = conn.execute(
            "SELECT id FROM media_items WHERE id = ? AND is_active = 1", (item_id,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Media item not found")

        if patch.is_favorite is not None:
            conn.execute(
                "UPDATE media_items SET is_favorite = ? WHERE id = ?",
                (1 if patch.is_favorite else 0, item_id),
            )
        if patch.title is not None:
            conn.execute(
                "UPDATE media_items SET title = ? WHERE id = ?",
                (patch.title.strip(), item_id),
            )
    return {"status": "ok"}


# ── Thumbnail serving ─────────────────────────────────────────────────────

@router.get("/{item_id}/thumbnail")
def serve_thumbnail(item_id: int):
    """Serve thumbnail, generating it lazily if not yet cached."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, media_type, path, duration_seconds, thumbnail_path "
            "FROM media_items WHERE id = ? AND is_active = 1",
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media item not found")

    thumb_path = row["thumbnail_path"]

    # Check if cached path still exists
    if thumb_path and Path(thumb_path).exists():
        return FileResponse(thumb_path, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})

    # Generate thumbnail lazily
    generated: Optional[Path] = None
    if row["media_type"] == "video":
        generated = generate_video_thumbnail(
            item_id, row["path"], row["duration_seconds"]
        )
    else:
        generated = generate_image_thumbnail(item_id, row["path"])

    if generated and generated.exists():
        # Persist the path
        with get_db() as conn:
            update_thumbnail_in_db(conn, item_id, generated)
        return FileResponse(str(generated), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})

    # Return a placeholder response
    raise HTTPException(status_code=404, detail="Thumbnail not available")


# ── Full image serving ────────────────────────────────────────────────────

@router.get("/{item_id}/full")
def serve_full_image(item_id: int):
    """
    Serve full-resolution image.
    HEIC files are converted to JPEG and cached on first request.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, media_type, path FROM media_items "
            "WHERE id = ? AND is_active = 1",
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media item not found")
    if row["media_type"] != "image":
        raise HTTPException(status_code=400, detail="Not an image item")

    path = Path(row["path"])
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    ext = path.suffix.lower()

    # HEIC/HEIF — convert to JPEG
    if ext in (".heic", ".heif"):
        converted = get_or_convert_heic(item_id, str(path))
        if converted and converted.exists():
            return FileResponse(str(converted), media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})
        raise HTTPException(status_code=415, detail="HEIC conversion unavailable (install pillow-heif)")

    # Serve file directly for other formats
    mime_map = {
        ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".png": "image/png", ".webp": "image/webp",
        ".gif": "image/gif", ".bmp": "image/bmp",
        ".tiff": "image/tiff", ".tif": "image/tiff",
    }
    mime = mime_map.get(ext, "application/octet-stream")
    return FileResponse(str(path), media_type=mime, headers={"Cache-Control": "public, max-age=86400"})


# ── Video streaming with Range support ───────────────────────────────────

def _parse_range_header(range_header: str, file_size: int) -> tuple[int, int]:
    """Parse 'bytes=start-end' Range header. Returns (start, end) byte offsets."""
    match = re.match(r"bytes=(\d*)-(\d*)", range_header)
    if not match:
        return 0, file_size - 1
    start_str, end_str = match.group(1), match.group(2)
    start = int(start_str) if start_str else 0
    end = int(end_str) if end_str else file_size - 1
    end = min(end, file_size - 1)
    return start, end


def _file_chunk_generator(path: str, start: int, end: int) -> Iterator[bytes]:
    """Yield chunks of a file between start and end byte positions."""
    with open(path, "rb") as f:
        f.seek(start)
        remaining = end - start + 1
        while remaining > 0:
            chunk_size = min(CHUNK_SIZE, remaining)
            data = f.read(chunk_size)
            if not data:
                break
            remaining -= len(data)
            yield data


def _transcoded_chunk_generator(transcoded_path: str, start: int, end: int) -> Iterator[bytes]:
    """Yield chunks of the transcoded file."""
    yield from _file_chunk_generator(transcoded_path, start, end)


def _ffmpeg_pipe_generator(
    file_path: str, seek_seconds: float = 0.0
) -> Iterator[bytes]:
    """
    Stream transcoded output directly from ffmpeg stdout.
    NOTE: seeking is best-effort — ffmpeg restarts from a keyframe near the offset.
    This is a known limitation for on-the-fly transcoding (see spec section 6a).
    """
    cmd = [
        "ffmpeg",
        "-ss", str(seek_seconds),
        "-i", file_path,
        "-c:v", "libx264",
        "-preset", "ultrafast",  # fastest encoding for streaming
        "-crf", "28",
        "-c:a", "aac",
        "-b:a", "96k",
        "-movflags", "frag_keyframe+empty_moov+faststart",
        "-f", "mp4",
        "pipe:1",
    ]
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
    )
    try:
        while True:
            chunk = proc.stdout.read(CHUNK_SIZE)  # type: ignore[union-attr]
            if not chunk:
                break
            yield chunk
    finally:
        proc.stdout.close()  # type: ignore[union-attr]
        proc.wait()


@router.get("/{item_id}/stream")
def stream_video(item_id: int, request: Request):
    """
    Stream a video with HTTP Range request support (206 Partial Content).
    Enables full-duration playback and smooth seeking across the feed and viewer.
    """
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, media_type, path, browser_native, duration_seconds "
            "FROM media_items WHERE id = ? AND is_active = 1",
            (item_id,),
        ).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Media item not found")
    if row["media_type"] != "video":
        raise HTTPException(status_code=400, detail="Not a video item")

    file_path = Path(row["path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File not found on disk")

    ext = file_path.suffix.lower()

    mime_types = {
        ".mp4": "video/mp4",
        ".m4v": "video/mp4",
        ".mov": "video/mp4",
        ".webm": "video/webm",
        ".ogv": "video/ogg",
        ".mkv": "video/mp4",
        ".avi": "video/mp4",
        ".ts": "video/mp2t",
        ".mts": "video/mp2t",
    }
    content_type = mime_types.get(ext, "video/mp4")

    # If transcoded file already exists, serve it
    transcoded_path = get_transcoded_path(item_id)
    if transcoded_path.exists():
        return _serve_file_with_range(str(transcoded_path), request, "video/mp4")

    # For legacy non-browser-native files, transcode on-demand and cache
    if not row["browser_native"]:
        transcoded = transcode_video(item_id, str(file_path))
        if transcoded and transcoded.exists():
            return _serve_file_with_range(str(transcoded), request, "video/mp4")

    # Serve original file directly with full 206 Range support
    return _serve_file_with_range(str(file_path), request, content_type)


def _serve_file_with_range(
    file_path: str, request: Request, content_type: str
) -> Response:
    """Serve a file with proper HTTP Range / 206 Partial Content support."""
    file_size = os.path.getsize(file_path)
    range_header = request.headers.get("range")

    if not range_header:
        # No Range header — serve the whole file
        headers = {
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Content-Type": content_type,
            "Cache-Control": "public, max-age=3600",
        }
        return StreamingResponse(
            _file_chunk_generator(file_path, 0, file_size - 1),
            status_code=200,
            headers=headers,
        )

    start, end = _parse_range_header(range_header, file_size)

    if start >= file_size:
        raise HTTPException(
            status_code=416,
            detail="Range Not Satisfiable",
            headers={"Content-Range": f"bytes */{file_size}"},
        )

    content_length = end - start + 1
    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Content-Length": str(content_length),
        "Accept-Ranges": "bytes",
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=3600",
    }
    return StreamingResponse(
        _file_chunk_generator(file_path, start, end),
        status_code=206,
        headers=headers,
    )
