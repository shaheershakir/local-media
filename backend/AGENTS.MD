# Backend Subsystem Instructions (AGENTS.MD)

## Purpose & Scope

This file provides rules and constraints for coding agents working within the `backend/` directory of the LocalFeed repository.

---

## 1. Stack & Architecture

- **Framework**: FastAPI + Uvicorn
- **Database**: SQLite3 (`sqlite3` stdlib with connection helper in [app/db.py](file:///f:/local-media/backend/app/db.py))
- **Media Engine**: FFmpeg / FFprobe for probing, thumbnailing, and transcoding
- **Dependencies**: Pinned in [requirements.txt](file:///f:/local-media/backend/requirements.txt)

---

## 2. Core Backend Invariants

1. **Local-Only & Loopback**:
   - The server binds strictly to `127.0.0.1`.
   - Never introduce remote cloud analytics, telemetry, or external network dependencies.

2. **Configuration Hierarchy**:
   - Always read system settings and paths through [app/config.py](file:///f:/local-media/backend/app/config.py).
   - Never hardcode machine-specific paths or user directories.
   - Media extensions and browser-native codec lists belong in `config.py`.

3. **Database Guidelines**:
   - Access the database via the `get_db()` context manager.
   - Connection operates in WAL mode with auto-commit on context exit.
   - Do NOT execute destructive schema migrations. Existing user databases must remain compatible.

4. **Async & Process Safety**:
   - Heavy CPU or process operations (FFmpeg transcoding, full directory scans) must run in daemon threads or background queues, never blocking the FastAPI async event loop.

---

## 3. Streaming & Seeking Guidelines

When modifying [app/routers/media.py](file:///f:/local-media/backend/app/routers/media.py) or streaming utilities:

1. **Browser-Native & Completed Transcodes**:
   - Must support HTTP 206 Range requests with accurate `Content-Range`, `Content-Length`, and `Accept-Ranges: bytes`.
   - Handle edge cases (e.g. `start >= file_size` returns `416 Range Not Satisfiable`).
2. **Live Transcode (Fragmented MP4)**:
   - Live stream pipes must return `Accept-Ranges: none` and `Cache-Control: no-cache, no-store`.
   - Seek parameters (`?t=` or `?seek=`) must pass `-ss <seconds>` **before** `-i` in the FFmpeg command line for fast keyframe seeking.
   - Never remove seek parameter handling or replace it with a byte-range seek attempt.

---

## 4. Testing & Validation

Always run the seeking regression suite when changing streaming or transcoding code:

```bash
cd backend
python test_seeking.py
```

---

## 5. Related Documentation

- [docs/api.md](file:///f:/local-media/docs/api.md) — Complete REST endpoint schemas and query parameters.
- [docs/database.md](file:///f:/local-media/docs/database.md) — SQLite schema, indexes, and lifecycle state.
- [docs/playback.md](file:///f:/local-media/docs/playback.md) — Video streaming, seeking pipeline, and codec definitions.
- [docs/testing.md](file:///f:/local-media/docs/testing.md) — Backend testing procedures.
