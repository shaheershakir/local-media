# LocalFeed Architecture & MPV Integration Strategy

## 1. Overview & Core Mission

**LocalFeed** is a privacy-first, offline local media application inspired by modern short-form feeds (TikTok, Instagram Reels) and private vault media centers. It catalogs, indexes, and streams personal photo and video collections from local storage with high performance and zero external tracking.

---

## 2. System Architecture

The application is structured in three cohesive layers:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Frontend Layer (React 19 + Vite)                   │
│  - ReelsFeed / MediaCard (vertical scroll-snap feed, full playback)     │
│  - MediaViewer (full player modal + format fallback handler)            │
│  - GridFeed / FolderProfile / SearchPage                                │
│  - useMpv Hook & MpvFloatingControl (playback HUD & event sync)         │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │  window.localfeed.mpv.*
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      Electron Shell Layer (Node 22)                     │
│  - Preload Script (`preload.ts`): Context-isolated IPC bridge           │
│  - Main Process (`main.ts`): Window management, lifecycle               │
│  - MPV Controller Service (`mpv.ts`): `node-mpv` wrapper & socket IPC    │
│  - Binary Detector: Resolves `mpv` from PATH / Chocolatey / env         │
└───────────────────┬─────────────────────────────────┬───────────────────┘
                    │                                 │
                    │ HTTP REST / Streams             │ Named Pipe / IPC Socket
                    ▼                                 ▼
┌──────────────────────────────────────┐  ┌───────────────────────────────┐
│       Backend Layer (FastAPI)        │  │          MPV Player           │
│  - SQLite Database (`localfeed.db`)  │  │  - Universal codec support    │
│  - Filesystem Scanner & Metadata     │  │  - Full duration playback     │
│  - Lazy Thumbnail Generator          │  │  - Legacy formats (AVI, WMV,  │
│  - Video Streamer (Range Requests)   │  │    FLV, MKV, AC3, DTS, etc.)  │
└──────────────────────────────────────┘  └───────────────────────────────┘
```

---

## 3. MPV Integration Approaches in Electron

Integrating MPV into an Electron application typically follows one of two primary architectural models:

### Option A: Custom HTML/React UI Controlling MPV via IPC
- **How it works**: MPV runs with IPC enabled (via JSON IPC socket on Unix or named pipe `\\.\pipe\mpvsocket` on Windows) managed by `node-mpv`.
- **UI Control**: Electron/React provides the interface (play, pause, seek, volume, progress bar, track selection, playlist). MPV renders the video surface while React controls all playback logic, state synchronization, and notifications.
- **Benefits**:
  - Full design freedom using our Dark Luxury / Cormorant Garamond design system.
  - No fragile C++ native addon recompilations on Electron upgrades.
  - Robust against Chromium codec limitations.

### Option B: Native Rendering / Direct Window Integration
- **How it works**: MPV creates a native video rendering window or attaches to a parent window handle (HWND/X11 window ID via `--wid`).
- **Benefits**: Hardware-accelerated zero-copy rendering directly through MPV's libplacebo/GPU pipeline.

### LocalFeed Hybrid Integration Strategy
LocalFeed implements a **versatile hybrid integration strategy**:
1. **Primary Feed & Standard Video**: In-feed autoplay and full-duration video playback via HTML5 `<video>` for modern browser-native formats (H.264, VP8, VP9, AV1, WebM, MP4).
2. **Full Playback & Legacy Format Engine via `node-mpv`**:
   - For legacy or non-browser-native formats (AVI, WMV, FLV, MKV with MPEG-2/DivX/XviD, TS/MTS, audio with AC3/DTS/WMA), clicking the video or pressing "Play in MPV" seamlessly invokes `node-mpv` targeting the native disk path (`item.path`).
   - The Electron main process communicates bidirectionally with MPV via IPC, streaming state (`time-position`, `duration`, `pause`, `idle-active`) into React state.
   - An on-screen floating control HUD appears in LocalFeed allowing full remote control (pause, resume, seek, volume, stop).

---

## 4. End-to-End Playback Flow

```
1. User interacts with a video card in ReelsFeed, GridFeed, or MediaViewer.
   ├── Normal Click / Tap: Starts full-length playback without any 10s preview cut-off.
   └── "Play in MPV" Click: Directly launches MPV with universal codec support.

2. Frontend invokes `window.localfeed.mpv.play(item.path, options)`.

3. Preload forwards request to Electron Main via `ipcRenderer.invoke('mpv:play', ...)`.

4. MPV Service (`electron/mpv.ts`):
   ├── Resolves the MPV binary (System PATH, Chocolatey, Scoop, or configured environment).
   ├── Launches `node-mpv` instance with IPC socket and custom parameters.
   ├── Opens the local file path directly (instant loading, zero transcoding delay).
   └── Listens to MPV events (`timeposition`, `statuschange`, `stopped`) and forwards them to renderer.

5. Frontend `useMpv` hook receives live telemetry:
   ├── Updates React state in real time.
   └── Renders the `MpvFloatingControl` mini-player HUD with progress, time, and playback controls.
```

---

## 5. Security & Privacy Guarantees

- **Context Isolation**: Renderer has zero direct access to Node.js primitives or `child_process`. All interactions happen over strictly typed IPC channels via `preload.ts`.
- **Zero External Telemetry**: All media paths, scan databases, thumbnails, and playback events remain 100% on the user's local machine.
- **Direct File Access for MPV**: MPV reads directly from local file paths without passing through temporary public servers or external network interfaces.
