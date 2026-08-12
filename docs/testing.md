# Testing & Validation Guide

This document outlines the testing architecture, automated regression suites, manual verification checklists, and legacy format validation procedures for LocalFeed.

---

## 1. Test Architecture Overview

```text
┌────────────────────────────────────────────────────────┐
│                   Frontend Checks                      │
│   • Oxlint (React/TS/OXC linter)                       │
│   • TypeScript Typechecking (tsc -b)                   │
│   • Vite Production Bundle Validation                  │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│                   Backend Tests                        │
│   • Seeking & Streaming Suite (test_seeking.py)        │
│   • Range Request & Content-Range Validation           │
│   • FFmpeg Live Transcoding & Pipe Verification        │
│   • SQLite Concurrency & WAL Integration               │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│                 Cross-Layer / Desktop                  │
│   • Electron Process Lifecycle & Health Probing        │
│   • IPC Contract Integrity                             │
│   • MPV Native Integration & State Sync                │
└────────────────────────────────────────────────────────┘
```

---

## 2. Automated Test Commands

### Frontend Linting & Build Checks

```bash
# Run Oxlint for static analysis (React hooks, TypeScript rules, imports)
npm --prefix frontend run lint

# Run TypeScript compiler and production build
npm --prefix frontend run build
```

> [!TIP]
> Always run both `lint` and `build` in `frontend/` before concluding any frontend change. Oxlint catches React hook rule violations that can cause subtle playback rerender bugs.

### Backend Seeking & Streaming Regression Suite

The primary automated regression test is [backend/test_seeking.py](file:///f:/local-media/backend/test_seeking.py). It exercises:
- Live `fMP4` transcoding from legacy AVI fixtures;
- Non-zero timestamp seeking (`?t=5.0`, `?seek=8.0`);
- Native MP4 HTTP 206 Partial Content Range streaming;
- Out-of-bounds range request handling (416 Range Not Satisfiable);
- Completed transcode caching and subsequent playback.

To execute the seeking test suite:

```bash
cd backend
python test_seeking.py
```

**Prerequisites for Backend Tests**:
- Python environment with requirements installed (`pip install -r requirements.txt`).
- `ffmpeg` and `ffprobe` binaries must be present on `PATH`.

---

## 3. Seeking & Range Request Test Matrix

When modifying streaming logic in [backend/app/routers/media.py](file:///f:/local-media/backend/app/routers/media.py) or player components in `frontend/src/components/`, execute the following test matrix:

| Scenario | Request | Expected Status | Expected Headers / Behavior |
|---|---|---|---|
| Native Video - Full Stream | `GET /api/media/{id}/stream` (no Range) | `200 OK` | `Accept-Ranges: bytes`, `Content-Length: <size>` |
| Native Video - Partial Range | `Range: bytes=0-1048575` | `206 Partial Content` | `Content-Range: bytes 0-1048575/<total>`, `Content-Length: 1048576` |
| Native Video - Mid-file Range | `Range: bytes=10485760-20971519` | `206 Partial Content` | `Content-Range: bytes 10485760-20971519/<total>` |
| Native Video - Suffix Range | `Range: bytes=-524288` (last 512KB) | `206 Partial Content` | `Content-Range: bytes <total-524288>-<total-1>/<total>` |
| Native Video - Out of Bounds | `Range: bytes=999999999-` | `416 Range Not Satisfiable` | `Content-Range: bytes */<total>` |
| Legacy Video - Initial Play | `GET /api/media/{id}/stream` | `200 OK` | `X-Playback-Mode: live-transcode`, `Accept-Ranges: none`, fMP4 stream starts < 300ms |
| Legacy Video - Seek to 15s | `GET /api/media/{id}/stream?t=15` | `200 OK` | `X-Playback-Mode: live-transcode`, `X-Seek-Offset: 15.0`, stream begins at ~15s |
| Legacy Video - Cached Disk | `GET /api/media/{id}/stream` (after transcode completes) | `206 Partial Content` (with Range) | Served as standard MP4 from `TRANSCODED_DIR` |

---

## 4. Manual Verification Checklist

Follow this checklist before finalizing desktop or media changes:

### Desktop & Process Management
- [ ] Launch application via `npm run dev` and ensure:
  - [ ] Python backend spawns and `/api/health` returns `200 OK` within 5 seconds.
  - [ ] Electron BrowserWindow opens without white-screen or context isolation errors.
  - [ ] Closing the Electron window cleans up the Python backend process (`taskkill` / `SIGTERM`) without orphaned processes.

### File Dialogs & IPC Bridge
- [ ] Navigate to **Settings** (`/settings`):
  - [ ] Click "Add Folder" — native directory picker opens and returns path.
  - [ ] Trigger scan — progress banner appears and updates item count in realtime.
  - [ ] Test "Reveal in Folder" on a media card — native file explorer highlights the file.

### Media Playback
- [ ] **Home / Explore Grid**:
  - [ ] Thumbnails load smoothly without UI stutter.
  - [ ] Hover/preview behaviors trigger correctly.
- [ ] **Reels Feed (`/feed`)**:
  - [ ] Vertical scrolling snaps cleanly to next media item.
  - [ ] Current visible video auto-plays; previous video pauses.
  - [ ] Infinite scrolling loads subsequent batches without duplicate items or infinite loops.
- [ ] **Cinema Player (`/watch/{id}`)**:
  - [ ] Play, pause, volume slider, and mute toggle work.
  - [ ] Timeline scrub updates video position smoothly.
  - [ ] MPV toggle switches player to native hardware decoding when MPV is installed.
