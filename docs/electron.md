# Electron Desktop Shell Architecture

This document describes the Electron desktop layer in LocalFeed, including process orchestration, native IPC channels, security isolation, Python backend management, and MPV native player integration.

---

## 1. Process Architecture & Layer Boundaries

```text
┌────────────────────────────────────────────────────────┐
│               Electron Main Process                    │
│   • Lifecycle coordination (startup / shutdown)        │
│   • Python backend child process management            │
│   • Native dialogs & notifications                     │
│   • MPV controller & socket IPC management             │
│   • BrowserWindow & Chromium media flags               │
└──────────────────────────┬─────────────────────────────┘
                           │ (Context-Isolated Preload Bridge)
                           │ window.localfeed
                           ▼
┌────────────────────────────────────────────────────────┐
│             Vite / React Renderer Process              │
│   • React 19 UI & HashRouter                           │
│   • No direct Node.js or child_process access          │
│   • Communicates with backend via loopback HTTP        │
│   • Communicates with desktop via window.localfeed     │
└────────────────────────────────────────────────────────┘
```

---

## 2. Startup & Shutdown Lifecycle

```text
[ app.whenReady() ]
       │
       ▼
1. Register Chromium Media Switches (PlatformHEVCDecoderSupport, autoplay-policy)
       │
       ▼
2. Register Native IPC Handlers (dialogs, notifications, MPV, shell)
       │
       ▼
3. startPythonBackend()
   ├── Dev: spawn 'python -m uvicorn app.main:app'
   └── Packaged: spawn 'process.resourcesPath/backend/localfeed.exe'
       │
       ▼
4. Health Check Loop (Polls http://127.0.0.1:8000/api/health until OK)
       │
       ▼
5. createMainWindow() (Creates 1280x800 BrowserWindow with preload script)
       │
       ▼
6. mpvController.setMainWindow(mainWindow)
```

### Shutdown Sequence (`before-quit`)
1. `mpvController.destroy()` closes active MPV socket connections and terminates player instances.
2. `stopPythonBackend()` executes a tree-kill (`taskkill /pid <pid> /T /F` on Windows; `SIGTERM` on Unix) to prevent orphaned Python or FFmpeg processes.
3. System tray and window resources are disposed.

---

## 3. Preload Bridge & Security Boundary

> [!IMPORTANT]
> The renderer runs with `contextIsolation: true` and `nodeIntegration: false`. The renderer must never have access to `require`, `process`, `child_process`, or raw `ipcRenderer`.

The bridge is exposed via `contextBridge.exposeInMainWorld('localfeed', ...)` in [electron/preload.ts](file:///f:/local-media/electron/preload.ts) and typed in [electron/global.d.ts](file:///f:/local-media/electron/global.d.ts):

```typescript
window.localfeed = {
  apiBaseUrl: 'http://127.0.0.1:8000/api',
  platform: 'win32' | 'darwin' | 'linux',
  selectFiles: () => Promise<string[]>,
  selectFolder: () => Promise<string | undefined>,
  notify: (title: string, body: string) => Promise<void>,
  revealPath: (path: string) => Promise<void>,
  mpv: {
    isAvailable: () => Promise<boolean>,
    getStatus: () => Promise<MpvStatusData>,
    play: (filePath: string, meta?: MpvPlaybackOptions) => Promise<{ success: boolean; message?: string }>,
    pause: () => Promise<boolean>,
    resume: () => Promise<boolean>,
    togglePause: () => Promise<boolean>,
    stop: () => Promise<boolean>,
    seek: (seconds: number) => Promise<boolean>,
    goToPosition: (seconds: number, exact?: boolean) => Promise<boolean>,
    setVolume: (volume: number) => Promise<boolean>,
    toggleMute: () => Promise<boolean>,
    onStatus: (callback: (status: MpvStatusData) => void) => () => void,
    onTimePosition: (callback: (timeData: { currentTime: number; duration?: number }) => void) => () => void,
  }
}
```

---

## 4. Python Backend Lifecycle (`electron/python.ts`)

- **Port & Host**: Fixed to `127.0.0.1:8000`.
- **Environment Injection**:
  - Sets `DB_PATH`, `THUMBNAIL_DIR`, and `TRANSCODED_DIR` to user application data (`app.getPath('userData')`).
  - Prepends packaged FFmpeg directory (`process.resourcesPath/ffmpeg`) to `PATH` in packaged mode.
- **Port Conflict Handling**:
  - Probes `http://127.0.0.1:8000/api/health` before spawning. If an existing backend from a prior session is already alive, it reuses the instance safely.

---

## 5. MPV Native Player Integration (`electron/mpv.ts`)

- **Binary Resolution**: Looks for `mpv.exe` in system `PATH` or bundled directories.
- **Window Embedding**: On Windows, MPV can attach to Electron's native window using `--wid=<HWND>` passed during initialization.
- **Event Dispatching**:
  - MPV property changes (`pause`, `time-pos`, `duration`, `volume`, `mute`) emit events over an IPC socket, which are translated and forwarded to the renderer via `mainWindow.webContents.send('mpv:status', ...)`.
