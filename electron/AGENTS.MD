# Electron Subsystem Instructions (AGENTS.MD)

## Purpose & Scope

This file provides rules and constraints for coding agents working within the `electron/` directory of the LocalFeed repository.

---

## 1. Subsystem Architecture

- **Coordinator**: [main.ts](file:///f:/local-media/electron/main.ts) (Configures Chromium flags, registers IPC, orchestrates startup/teardown)
- **Preload Bridge**: [preload.ts](file:///f:/local-media/electron/preload.ts) (Secure context bridge exposing `window.localfeed`)
- **Global Types**: [global.d.ts](file:///f:/local-media/electron/global.d.ts) (TypeScript types for the preload bridge)
- **Window Management**: [window.ts](file:///f:/local-media/electron/window.ts) (BrowserWindow creation, preload configuration)
- **Backend Lifecycle**: [python.ts](file:///f:/local-media/electron/python.ts) (Uvicorn / PyInstaller process manager and health check)
- **MPV Controller**: [mpv.ts](file:///f:/local-media/electron/mpv.ts) (Native MPV socket interface and window embedding)

---

## 2. Core Electron Invariants

1. **Security & Context Isolation**:
   - `contextIsolation: true` and `nodeIntegration: false` must remain enabled.
   - Never expose raw `ipcRenderer`, `process`, `require`, or `child_process` to the renderer.

2. **IPC API Maintenance Rule**:
   When changing or adding an IPC channel, you MUST update all 4 layers in unison:
   1. The IPC handler in [main.ts](file:///f:/local-media/electron/main.ts).
   2. The bridge method in [preload.ts](file:///f:/local-media/electron/preload.ts).
   3. The TypeScript interface in [global.d.ts](file:///f:/local-media/electron/global.d.ts).
   4. The consuming frontend component / hook.

3. **Process Teardown**:
   - Always ensure child processes (Python backend and MPV) are terminated on `app.on('before-quit')`.
   - On Windows, use process tree termination (`taskkill /pid ... /T /F`) to eliminate orphaned workers.

4. **Resource Paths (Dev vs Packaged)**:
   - Development uses Python and Uvicorn from `backend/`.
   - Packaged production uses `process.resourcesPath/backend/localfeed.exe` and `process.resourcesPath/ffmpeg/ffmpeg.exe`.
   - Test changes against both development and packaged paths.

---

## 3. MPV Controller Invariants

- MPV is optional; the app must remain functional if MPV is not installed.
- Window embedding uses `--wid` with the native window handle.
- Transport state (play, pause, seek, volume, mute) must stay synchronized with the React UI via `mpv:status` and `mpv:timeposition` IPC events.

---

## 4. Build & Validation

```bash
# Bundle Electron main and preload scripts
npm run build:electron

# Validate full packaging pipeline
npm run build
```

---

## 5. Related Documentation

- [docs/electron.md](file:///f:/local-media/docs/electron.md) — Electron process lifecycle and IPC channel table.
- [docs/playback.md](file:///f:/local-media/docs/playback.md) — Playback decision tree and MPV integration.
- [docs/packaging.md](file:///f:/local-media/docs/packaging.md) — Electron-builder and PyInstaller packaging.
