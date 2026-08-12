# AGENTS.md

## Purpose & Scope

This file provides root instructions and core invariants for AI coding agents working on the `local-media` repository (LocalFeed).

LocalFeed uses a **hierarchical agent documentation model**:
- This root file covers **mandatory cross-cutting rules, core invariants, and cross-layer checklists**.
- Detailed subsystem rules are located in scoped `AGENTS.MD` files within each subsystem directory.
- In-depth technical guides, API specs, and runbooks are maintained under `docs/`.

---

## Repository Overview & Architecture

LocalFeed is a privacy-first local media desktop application with a strict three-layer architecture:

```text
┌────────────────────────────────────────────────────────┐
│  frontend/ (React 19 + TypeScript + Vite Renderer)     │
│  • Custom UI, routing, feeds, cinema players           │
│  • Reaches native desktop via window.localfeed bridge  │
│  • Reaches backend via loopback HTTP (127.0.0.1:8000)  │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────┴─────────────────────────────┐
│  electron/ (Electron Main & Preload Layer)             │
│  • Desktop lifecycle, native dialogs, shell operations │
│  • Manages Python backend lifecycle & MPV integration  │
│  • Context isolation bridge (electron/preload.ts)      │
└──────────────────────────┬─────────────────────────────┘
                           │
┌──────────────────────────┴─────────────────────────────┐
│  backend/ (FastAPI + SQLite Local Service)             │
│  • Filesystem scanner & metadata extraction            │
│  • SQLite database, thumbnails & video transcoding    │
│  • HTTP Range video streaming & live transcode pipes   │
└────────────────────────────────────────────────────────┘
```

---

## Documentation & Guidance Map

Before making deep changes in any subsystem, consult the corresponding scoped documentation:

### Subsystem Instruction Manifests
- [frontend/AGENTS.MD](file:///f:/local-media/frontend/AGENTS.MD) — React 19 conventions, state ownership, Oxlint, and component rules.
- [backend/AGENTS.MD](file:///f:/local-media/backend/AGENTS.MD) — FastAPI router design, SQLite rules, transcoding, and streaming logic.
- [electron/AGENTS.MD](file:///f:/local-media/electron/AGENTS.MD) — IPC maintenance, security boundary, Python lifecycle, and MPV integration.

### Topic-Specific Technical Guides (`docs/`)
- [docs/playback.md](file:///f:/local-media/docs/playback.md) — Playback decision tree, seeking semantics, Range requests, and MPV sync.
- [docs/testing.md](file:///f:/local-media/docs/testing.md) — Test architecture, regression suite (`test_seeking.py`), and verification checklists.
- [docs/development.md](file:///f:/local-media/docs/development.md) — Setup prerequisites, dev workflows, and environment variables.
- [docs/api.md](file:///f:/local-media/docs/api.md) — Complete FastAPI endpoint specification and frontend API mappings.
- [docs/database.md](file:///f:/local-media/docs/database.md) — SQLite schema, indexes, lifecycle states, and migration guidelines.
- [docs/frontend.md](file:///f:/local-media/docs/frontend.md) — UI architecture, route map, state ownership, and component hierarchy.
- [docs/electron.md](file:///f:/local-media/docs/electron.md) — Electron process lifecycle, window management, and IPC channels.
- [docs/packaging.md](file:///f:/local-media/docs/packaging.md) — Build pipeline, PyInstaller spec, resource bundling, and installers.
- [docs/troubleshooting.md](file:///f:/local-media/docs/troubleshooting.md) — Diagnostic runbooks for common failures.
- [docs/architecture.md](file:///f:/local-media/docs/architecture.md) — Architectural invariants and boundary contracts.
- [docs/feed-infinite-loading-analysis-and-fix.md](file:///f:/local-media/docs/feed-infinite-loading-analysis-and-fix.md) — Feed loading investigation history.

---

## Core Non-Negotiable Invariants

### 1. Keep the Three Layers Separated
- React code must **never** directly access Node.js or Electron APIs (`fs`, `child_process`, `electron`).
- Native desktop operations belong in `electron/` and are exposed exclusively through `electron/preload.ts` and `electron/global.d.ts`.
- Media indexing, database access, thumbnails, transcoding, and streaming belong in the FastAPI backend.
- Do not move backend filesystem/DB logic into Electron, and do not move native process management into React.

### 2. Treat IPC as a Typed Public Internal API
When adding or modifying an IPC channel, you must update all 4 touchpoints in unison:
1. IPC handler in [electron/main.ts](file:///f:/local-media/electron/main.ts).
2. Preload bridge method in [electron/preload.ts](file:///f:/local-media/electron/preload.ts).
3. TypeScript interface in [electron/global.d.ts](file:///f:/local-media/electron/global.d.ts).
4. All consuming renderer components and hooks in `frontend/`.

### 3. Preserve Local-Only Privacy & Loopback Security
- The backend binds strictly to `127.0.0.1`.
- Never introduce remote telemetry, external analytics, or cloud storage dependencies.
- Never disable `contextIsolation` or enable `nodeIntegration` in the renderer.

---

## Key Build & Validation Commands

From the repository root:

```bash
# Run full development stack (Frontend + Electron + Backend)
npm run dev

# Frontend validation (Oxlint & TypeScript type-check)
npm --prefix frontend run lint
npm --prefix frontend run build

# Backend seeking & streaming regression suite
cd backend && python test_seeking.py

# Full build pipeline (Renderer + Electron + PyInstaller backend)
npm run build

# Windows distribution packaging (NSIS + Portable)
npm run dist:win
```

---

## Cross-Layer Change Checklist

### If changing a Backend API:
1. Update FastAPI router in `backend/app/routers/`.
2. Update corresponding frontend API module in `frontend/src/api/`.
3. Update TypeScript response types in `frontend/src/api/types.ts`.
4. Check affected UI components and verify `docs/api.md` remains accurate.

### If changing an Electron IPC Channel:
1. Update handler in `electron/main.ts`.
2. Update bridge in `electron/preload.ts`.
3. Update types in `electron/global.d.ts`.
4. Update consuming frontend components/hooks.

### If changing Playback or Streaming:
1. Trace the full pipeline:
   ```text
   React Player ──► Preload Bridge ──► Backend Stream / MPV ──► FFmpeg / Filesystem
   ```
2. Verify both **browser-native** formats (MP4, WebM) and **legacy formats** (AVI, WMV, FLV, MPG).
3. Run `python test_seeking.py` to ensure HTTP Range requests and non-zero seek offsets work properly.

---

## Things Agents Should Not Do

- **Do not** replace the React/Vite/Electron/FastAPI architecture with another framework.
- **Do not** introduce external cloud storage or remote databases.
- **Do not** expose Node/Electron APIs directly to the renderer.
- **Do not** remove HTTP Range request handling or seek parameter handling to simplify playback code.
- **Do not** hardcode user-specific machine paths or commit `.env` files with personal data.
- **Do not** make large unrelated refactors while fixing a focused bug.
- **Do not** claim a playback fix works for legacy formats without validating against the test suite or live transcode pipeline.

---

## Definition of Done

A task is complete when:
- The change fixes the issue or implements the feature cleanly at the correct architectural layer.
- Layer boundaries and context isolation remain strictly intact.
- TypeScript contracts and Python response models are synchronized.
- Relevant lint, build, and test checks pass.
- Documentation in `docs/` is updated if durable architecture, API, or workflow rules changed.
