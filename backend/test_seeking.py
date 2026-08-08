"""
Automated unit tests for video playback seek/scrub pipeline.
Tests RFC 7233 range parsing, metadata extraction, live FFmpeg piping with seek offsets,
background transcoding, and FastAPI streaming endpoints for native and legacy formats.
"""
import os
import subprocess
import tempfile
from pathlib import Path
from starlette.datastructures import Headers
from starlette.requests import Request

from app.routers.media import _parse_range_header, _ffmpeg_pipe_generator, _to_seek_seconds, stream_video, transcode_status
from app.scanner import _extract_video_metadata
from app.thumbnails import transcode_video, get_transcoded_path
from app.db import get_db, create_schema


def test_parse_range_header():
    file_size = 10000

    # Full range
    assert _parse_range_header("bytes=0-9999", file_size) == (0, 9999)

    # Offset to end
    assert _parse_range_header("bytes=500-", file_size) == (500, 9999)

    # Explicit sub-range
    assert _parse_range_header("bytes=500-1000", file_size) == (500, 1000)

    # Suffix range (last N bytes according to RFC 7233)
    assert _parse_range_header("bytes=-500", file_size) == (9500, 9999)

    # No range or invalid header defaults to full range
    assert _parse_range_header("", file_size) == (0, 9999)
    assert _parse_range_header("invalid", file_size) == (0, 9999)

    # Out-of-bounds clamped
    assert _parse_range_header("bytes=0-20000", file_size) == (0, 9999)


def test_to_seek_seconds():
    assert _to_seek_seconds(None) is None
    assert _to_seek_seconds("15.5") == 15.5
    assert _to_seek_seconds(30) == 30.0
    assert _to_seek_seconds(0) == 0.0
    assert _to_seek_seconds(-5) == 0.0
    assert _to_seek_seconds("invalid") is None


def test_ffmpeg_live_pipe_seeking():
    test_avi = Path("test_unit_seek.avi")
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=30:size=320x240:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=30",
        "-c:v", "mpeg4", "-c:a", "mp3",
        str(test_avi)
    ], capture_output=True, check=True)

    try:
        # Seek from beginning
        gen0 = _ffmpeg_pipe_generator(str(test_avi), seek_seconds=0.0)
        chunk0 = next(gen0)
        assert len(chunk0) > 0
        gen0.close()

        # Seek from 10s
        gen10 = _ffmpeg_pipe_generator(str(test_avi), seek_seconds=10.0)
        chunk10 = next(gen10)
        assert len(chunk10) > 0
        gen10.close()

        # Seek near end (28s)
        gen28 = _ffmpeg_pipe_generator(str(test_avi), seek_seconds=28.0)
        chunk28 = next(gen28)
        assert len(chunk28) > 0
        gen28.close()
    finally:
        try:
            test_avi.unlink(missing_ok=True)
        except Exception:
            pass


def test_streaming_endpoints_and_transcode():
    create_schema()

    # Create dummy media in a temp directory
    temp_dir = Path(tempfile.mkdtemp())
    dummy_avi = temp_dir / "sample.avi"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=10:size=320x240:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=10",
        "-c:v", "mpeg4", "-c:a", "mp3",
        str(dummy_avi)
    ], capture_output=True, check=True)

    dummy_mp4 = temp_dir / "sample.mp4"
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=10:size=320x240:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=10",
        "-c:v", "libx264", "-c:a", "aac",
        str(dummy_mp4)
    ], capture_output=True, check=True)

    with get_db() as conn:
        conn.execute("INSERT OR IGNORE INTO folders (id, name, path) VALUES (9999, 'TestFolder', ?)", (str(temp_dir),))
        conn.execute("DELETE FROM media_items WHERE id IN (888801, 888802, 888803)")
        conn.execute("""
            INSERT OR REPLACE INTO media_items (id, folder_id, filename, title, path, media_type, duration_seconds, browser_native, is_active)
            VALUES (888801, 9999, 'sample.avi', 'Sample AVI', ?, 'video', 10.0, 0, 1)
        """, (str(dummy_avi),))
        conn.execute("""
            INSERT OR REPLACE INTO media_items (id, folder_id, filename, title, path, media_type, duration_seconds, browser_native, is_active)
            VALUES (888802, 9999, 'sample.mp4', 'Sample MP4', ?, 'video', 10.0, 1, 1)
        """, (str(dummy_mp4),))

    try:
        # Mock request with no Range header
        scope_norange = {"type": "http", "headers": []}
        req_norange = Request(scope_norange)

        # Mock request with Range header
        scope_range = {"type": "http", "headers": [(b"range", b"bytes=0-1024")]}
        req_range = Request(scope_range)

        # 1. Test legacy on-the-fly streaming from 0s
        res_live0 = stream_video(888801, req_norange, t=None, seek=None)
        assert res_live0.headers.get("x-playback-mode") == "live-transcode"
        assert res_live0.headers.get("x-seek-offset") == "0.0"

        # 2. Test legacy on-the-fly streaming from 5.5s
        res_live5 = stream_video(888801, req_norange, t=5.5, seek=None)
        assert res_live5.headers.get("x-playback-mode") == "live-transcode"
        assert res_live5.headers.get("x-seek-offset") == "5.5"

        # 3. Test native video streaming with Range request
        res_native = stream_video(888802, req_range)
        assert res_native.status_code == 206
        assert res_native.headers.get("accept-ranges") == "bytes"
        assert "bytes 0-1024/" in res_native.headers.get("content-range", "")
        assert res_native.headers.get("content-length") == "1025"

        # 4. Test transcode status endpoints
        status_live = transcode_status(888801)
        assert status_live.get("status") in ("ready", "transcoding", "idle")

        status_native = transcode_status(888802)
        assert status_native.get("status") == "native"
    finally:
        dummy_avi.unlink(missing_ok=True)
        dummy_mp4.unlink(missing_ok=True)
        try:
            temp_dir.rmdir()
        except Exception:
            pass


def test_completed_transcode_range_playback():
    create_schema()
    test_avi = Path("test_transcode_range.avi")
    subprocess.run([
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=10:size=320x240:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=10",
        "-c:v", "mpeg4", "-c:a", "mp3",
        str(test_avi)
    ], capture_output=True, check=True)

    try:
        # Transcode to disk cache for item 888803
        out_mp4 = transcode_video(888803, str(test_avi.resolve()))
        assert out_mp4 is not None
        assert out_mp4.exists()
        assert out_mp4.stat().st_size > 0

        with get_db() as conn:
            conn.execute("""
                INSERT INTO media_items (id, folder_id, filename, title, path, media_type, duration_seconds, browser_native, is_active)
                VALUES (888803, 9999, 'test_transcode_range.avi', 'Range AVI', ?, 'video', 10.0, 0, 1)
            """, (str(test_avi.resolve()),))

        # Stream request with Range header
        scope_range = {"type": "http", "headers": [(b"range", b"bytes=0-1024")]}
        req_range = Request(scope_range)

        res_transcoded = stream_video(888803, req_range)
        assert res_transcoded.status_code == 206
        assert res_transcoded.headers.get("accept-ranges") == "bytes"
        assert "bytes 0-1024/" in res_transcoded.headers.get("content-range", "")
        assert res_transcoded.headers.get("content-length") == "1025"

        # Check transcode status returns ready
        status = transcode_status(888803)
        assert status.get("status") == "ready"
    finally:
        if test_avi.exists():
            test_avi.unlink(missing_ok=True)
        # Clean up transcoded file
        trans_path = get_transcoded_path(888803)
        if trans_path.exists():
            trans_path.unlink(missing_ok=True)
        with get_db() as conn:
            conn.execute("DELETE FROM media_items WHERE id = 888803")


if __name__ == "__main__":
    test_parse_range_header()
    print("test_parse_range_header PASSED")
    test_to_seek_seconds()
    print("test_to_seek_seconds PASSED")
    test_ffmpeg_live_pipe_seeking()
    print("test_ffmpeg_live_pipe_seeking PASSED")
    test_streaming_endpoints_and_transcode()
    print("test_streaming_endpoints_and_transcode PASSED")
    test_completed_transcode_range_playback()
    print("test_completed_transcode_range_playback PASSED")
    print("ALL TESTS PASSED SUCCESSFULLY!")

