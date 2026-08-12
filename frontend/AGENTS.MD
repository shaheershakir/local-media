# Frontend Subsystem Instructions (AGENTS.MD)

## Purpose & Scope

This file provides rules and constraints for coding agents working within the `frontend/` directory of the LocalFeed repository.

---

## 1. Stack & Tooling

- **UI Framework**: React 19 + TypeScript
- **Routing**: `react-router-dom` with `HashRouter` in [src/App.tsx](file:///f:/local-media/frontend/src/App.tsx)
- **Bundler**: Vite (`@vitejs/plugin-react`)
- **Linter**: Oxlint (`oxlint` with React/TypeScript/OXC rules)
- **Package Manager**: npm (uses existing root lockfile)

---

## 2. Core Frontend Invariants

1. **No Direct Node/Electron Access**:
   - Never import `fs`, `child_process`, `electron`, `path`, or any Node.js built-ins in the frontend.
   - All desktop functionality MUST go through `window.localfeed` (declared in [electron/global.d.ts](file:///f:/local-media/electron/global.d.ts)).
   - Always use safe optional chaining (`window.localfeed?.someMethod()`) so code works in both Vite browser mode and packaged Electron.

2. **Centralized API Calls**:
   - Never write raw `fetch()` calls inside components.
   - Use the typed API modules under [src/api/](file:///f:/local-media/frontend/src/api/) (`media.ts`, `folders.ts`, `scan.ts`, `sources.ts`, `recommendations.ts`).
   - Use [src/api/client.ts](file:///f:/local-media/frontend/src/api/client.ts) as the unified HTTP transport.

3. **State & Context Ownership**:
   - Reuse existing contexts before introducing new global state:
     - [NavigationStackContext](file:///f:/local-media/frontend/src/contexts/NavigationStackContext.tsx) for route history and scroll positions.
     - [AudioPreferenceProvider](file:///f:/local-media/frontend/src/contexts/AudioPreferenceProvider.tsx) for user volume and mute preferences.
   - Keep component-local state inside the component or a dedicated hook.

---

## 3. Playback Component Rules

When modifying playback-related components ([CustomCinemaPlayer.tsx](file:///f:/local-media/frontend/src/components/CustomCinemaPlayer.tsx), [VideoPlayer.tsx](file:///f:/local-media/frontend/src/components/VideoPlayer.tsx), [ReelsFeed.tsx](file:///f:/local-media/frontend/src/components/ReelsFeed.tsx), [MediaCard.tsx](file:///f:/local-media/frontend/src/components/MediaCard.tsx)):

1. **Native vs Live-Transcode Seeking**:
   - Native videos (`browser_native === 1`) seek via `video.currentTime`.
   - Legacy videos in live transcode mode (`browser_native === 0`) seek by updating the stream URL: `/api/media/{id}/stream?t={timestamp}`.
2. **MPV Synchronization**:
   - Always consume MPV through the [useMpv](file:///f:/local-media/frontend/src/hooks/useMpv.ts) hook.
   - Ensure event cleanup on unmount to prevent duplicate listener accumulation.
3. **Autoplay & Intersection**:
   - Autoplay in feeds must use `IntersectionObserver` ([useIntersectionAutoplay.ts](file:///f:/local-media/frontend/src/hooks/useIntersectionAutoplay.ts)) and pause off-screen media.

---

## 4. Linting & Validation

Always run and resolve any errors before finalizing frontend tasks:

```bash
# Run static analysis
npm --prefix frontend run lint

# Validate TypeScript types & production build
npm --prefix frontend run build
```

---

## 5. Related Documentation

- [docs/frontend.md](file:///f:/local-media/docs/frontend.md) — Comprehensive frontend architecture guide.
- [docs/playback.md](file:///f:/local-media/docs/playback.md) — Video streaming, seeking, and MPV details.
- [docs/api.md](file:///f:/local-media/docs/api.md) — Backend API schemas and endpoints.
- [docs/feed-infinite-loading-analysis-and-fix.md](file:///f:/local-media/docs/feed-infinite-loading-analysis-and-fix.md) — Feed pagination rules.
