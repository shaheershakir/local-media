# Troubleshooting & Known Failure Modes

This document provides structured diagnostic runbooks for resolving common issues in LocalFeed.

---

## Runbook 1: Backend Fails to Start (Port 8000 Conflict or Leaked Process)

### Symptoms
- Electron startup dialog shows `LocalFeed failed to start: Python backend did not become ready at http://127.0.0.1:8000/api/health`.
- Console shows `address already in use` or connection refused.

### Root Cause
A previous Python Uvicorn process did not terminate cleanly (e.g. after a hard crash or terminal kill) and is still holding port 8000.

### Correct Fix
1. Kill any existing Python processes on port 8000:
   - **Windows (PowerShell)**:
     ```powershell
     Get-NetTCPConnection -LocalPort 8000 -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
     ```
   - **Linux / macOS**:
     ```bash
     lsof -ti:8000 | xargs kill -9
     ```
2. Restart the app via `npm run dev`.

### Files Involved
- [electron/python.ts](file:///f:/local-media/electron/python.ts)

---

## Runbook 2: Legacy Video (AVI/WMV) Seek Always Starts from Beginning

### Symptoms
- Scrubbing a legacy video (e.g. AVI, WMV, FLV) in the cinema player immediately restarts playback from 0 seconds.

### Root Cause
Live transcoding streams cannot accept byte-range HTTP requests (`Accept-Ranges: none`). If the frontend attempts to seek by updating `video.currentTime` without appending `?t=<timestamp>` or `?seek=<timestamp>` to the stream URL, the browser requests the raw live stream from byte 0.

### Correct Fix
- In [frontend/src/components/CustomCinemaPlayer.tsx](file:///f:/local-media/frontend/src/components/CustomCinemaPlayer.tsx), detect non-native playback mode and update the stream URL:
  ```typescript
  videoRef.current.src = `${apiBaseUrl}/media/${item.id}/stream?t=${targetTime}`
  ```
- Ensure [backend/app/routers/media.py](file:///f:/local-media/backend/app/routers/media.py) parses `?t=` and places `-ss` before `-i` in FFmpeg args.

### Verification
```bash
cd backend
python test_seeking.py
```

---

## Runbook 3: Video Thumbnails Missing or Generation Error

### Symptoms
- Cards display placeholder icons instead of video frame thumbnails.
- Backend logs `ffmpeg / ffprobe not found on PATH!`.

### Root Cause
FFmpeg is either missing from the system environment or not bundled into the packaged application resources.

### Correct Fix
- **Development**: Install FFmpeg via package manager (e.g. `winget install Gyan.FFmpeg` or `brew install ffmpeg`) and ensure `ffmpeg` and `ffprobe` are in your system `PATH`.
- **Packaged Production**: Ensure `node_modules/ffmpeg-static/ffmpeg.exe` is copied to `resources/ffmpeg/` via `extraResources` in [package.json](file:///f:/local-media/package.json).

### Files Involved
- [backend/app/thumbnails.py](file:///f:/local-media/backend/app/thumbnails.py)
- [backend/app/config.py](file:///f:/local-media/backend/app/config.py)
- [package.json](file:///f:/local-media/package.json)

---

## Runbook 4: Infinite Feed Loading or Duplicate Items

### Symptoms
- The vertical Reels feed stutters, loops through the same 5 videos, or keeps fetching in an infinite loop.

### Root Cause
- Missing or malformed `exclude_ids` parameter sent to `/api/feed/random`.
- Feed component triggering `loadMore()` repeatedly while `loading` state is already `true`.

### Correct Fix
- Inspect [docs/feed-infinite-loading-analysis-and-fix.md](file:///f:/local-media/docs/feed-infinite-loading-analysis-and-fix.md).
- Ensure [useInfiniteFeed.ts](file:///f:/local-media/frontend/src/hooks/useInfiniteFeed.ts) tracks an active request lock and supplies recent IDs in `exclude_ids`.

---

## Runbook 5: `window.localfeed` is Undefined in Renderer

### Symptoms
- Uncaught TypeError: `Cannot read properties of undefined (reading 'selectFolder')` in frontend console.

### Root Cause
- Electron `BrowserWindow` was created with `contextIsolation: false` or preload path failed to resolve.
- In Vite browser development mode, native APIs are not present.

### Correct Fix
- Verify [electron/window.ts](file:///f:/local-media/electron/window.ts) specifies `webPreferences.preload` pointing to `dist-electron/preload.js`.
- In frontend code, always use optional chaining: `window.localfeed?.selectFolder()`.
