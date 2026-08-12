# Packaging & Distribution Guide

This document describes the multi-stage build pipeline, PyInstaller backend compilation, FFmpeg resource bundling, and Electron-builder distribution configuration for LocalFeed.

---

## 1. Multi-Stage Build Pipeline Overview

```text
1. Frontend Build:
   npm --prefix frontend run build ─────────► frontend/dist/ (HTML, JS, CSS)

2. Electron Transpilation:
   esbuild electron/main.ts electron/preload.ts ──► dist-electron/ (main.js, preload.js)

3. Python Backend Compilation:
   PyInstaller backend/localfeed.spec ──────► dist-python/localfeed.exe

4. Desktop Packaging:
   electron-builder --win ──────────────────► release/ (NSIS installer & portable exe)
```

---

## 2. Build Commands

```bash
# Step 1: Build Vite frontend
npm run build:renderer

# Step 2: Bundle Electron main & preload with esbuild
npm run build:electron

# Step 3: Compile FastAPI backend executable with PyInstaller
npm run build:backend

# Step 4: Run full multi-stage build
npm run build

# Step 5: Produce Windows distribution binaries (NSIS & Portable)
npm run dist:win
```

---

## 3. PyInstaller Backend Specification (`backend/localfeed.spec`)

The backend executable is compiled without a terminal console window (`console=False`).

Key bundling configuration:
- **Entry point**: `backend/app/main.py`
- **Hidden imports**:
  - `uvicorn` (lifespan, protocols, loops, formatters)
  - `fastapi`
  - `pillow_heif` (HEIC image decoding support)
- **Data files**: Bundles `pillow_heif` shared libraries.

> [!WARNING]
> Because `console=False` is set in production, `sys.stderr.isatty()` returns `False` or raises an exception. Uvicorn is invoked programmatically in [backend/app/main.py](file:///f:/local-media/backend/app/main.py) with standard logging rather than ANSI color formatters.

---

## 4. Electron-Builder Configuration (`package.json`)

The packaging rules in the root [package.json](file:///f:/local-media/package.json) define which assets are packaged into the ASAR archive and which are included as raw external resources:

```json
"build": {
  "appId": "com.localfeed.app",
  "productName": "LocalFeed",
  "directories": {
    "output": "release"
  },
  "files": [
    "dist-electron/**",
    "frontend/dist/**",
    "package.json"
  ],
  "extraResources": [
    {
      "from": "dist-python/localfeed.exe",
      "to": "backend/localfeed.exe"
    },
    {
      "from": "node_modules/ffmpeg-static/ffmpeg.exe",
      "to": "ffmpeg/ffmpeg.exe"
    }
  ],
  "asar": true,
  "win": {
    "target": [
      "nsis",
      "portable"
    ]
  },
  "nsis": {
    "oneClick": false,
    "allowToChangeInstallationDirectory": true
  }
}
```

---

## 5. Development vs. Packaged Runtime Differences

| Resource | Development Mode | Packaged Production Mode |
|---|---|---|
| **Frontend Source** | `http://127.0.0.1:5173` (Vite dev server) | `file://.../frontend/dist/index.html` (bundled in ASAR) |
| **Backend Binary** | `python -m uvicorn ...` (`backend/app/main.py`) | `process.resourcesPath/backend/localfeed.exe` |
| **FFmpeg Binary** | System `PATH` or `process.env.FFMPEG_DIR` | `process.resourcesPath/ffmpeg/ffmpeg.exe` |
| **Database Path** | `~/.localfeed/localfeed.db` | `%APPDATA%/localfeed-desktop/localfeed.db` |
| **Thumbnail Dir** | `~/.localfeed/thumbnails` | `%APPDATA%/localfeed-desktop/thumbnails` |
| **Transcoded Dir**| `~/.localfeed/transcoded` | `%APPDATA%/localfeed-desktop/transcoded` |
