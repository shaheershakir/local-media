# Frontend Architecture & Component Guide

This document describes the renderer UI architecture in LocalFeed, including route management, state ownership, component hierarchy, context providers, and performance guidelines.

---

## 1. Stack & Architecture

- **Framework**: React 19 + TypeScript
- **Bundler**: Vite with `@vitejs/plugin-react`
- **Routing**: `react-router-dom` using `HashRouter` (required for seamless desktop `file://` and Electron navigation)
- **Linter**: Oxlint with React and TypeScript rule sets

---

## 2. Route Map & Page Components

Routes are declared in [frontend/src/App.tsx](file:///f:/local-media/frontend/src/App.tsx):

| Route Path | Page / Wrapper Component | Description |
|---|---|---|
| `/` | [HomePage](file:///f:/local-media/frontend/src/pages/HomePage.tsx) | Hero banner, recent media, folder shelves, and quick access |
| `/feed` | [ReelsFeed](file:///f:/local-media/frontend/src/components/ReelsFeed.tsx) | Fullscreen vertical snap feed with autoplay and gestures |
| `/watch/:id` | [PlayerPage](file:///f:/local-media/frontend/src/pages/PlayerPage.tsx) | Cinema player view with recommendations sidebar |
| `/media/:id` | [PlayerPage](file:///f:/local-media/frontend/src/pages/PlayerPage.tsx) | Deep-link alias for player view |
| `/explore` | `ExplorePage` (`GridFeed`) | Paginated grid view of all indexed media |
| `/folders` | [FoldersPage](file:///f:/local-media/frontend/src/pages/FoldersPage.tsx) | Hierarchical folder directory and cover cards |
| `/folders/:id` | [FolderProfile](file:///f:/local-media/frontend/src/components/FolderProfile.tsx) | Folder media items, subfolders, and folder cover preview |
| `/favorites` | `FavoritesPage` (`GridFeed favoritesOnly`) | Saved / favorited media grid |
| `/search` | [SearchPage](file:///f:/local-media/frontend/src/pages/SearchPage.tsx) | Realtime keyword search over titles, files, and folders |
| `/settings` | [SettingsPage](file:///f:/local-media/frontend/src/pages/SettingsPage.tsx) | Library sources management, manual scans, statistics |

---

## 3. Component Hierarchy & State Ownership

```text
App (HashRouter)
 ├── AudioPreferenceProvider  (Global volume & mute persistence)
 │    └── NavigationStackProvider (Back/forward navigation history)
 │         └── AppShell
 │              ├── TopNav (History buttons, search shortcut)
 │              ├── NavigationGestures (Swipe back, desktop hotkeys)
 │              ├── ScanProgress (Persistent scanning status banner)
 │              ├── <main.page-content>
 │              │    ├── HomePage / ReelsFeed / PlayerPage / GridFeed / ...
 │              │    │    ├── MediaCard / VideoCard / ImageCard
 │              │    │    └── CustomCinemaPlayer / VideoPlayer / ImageViewer
 │              │    │    └── RecommendationSidebar
 │              ├── MpvFloatingControl (Mini player when MPV is active)
 │              └── BottomNav (Tab navigation)
```

### Key Context Providers

1. **[NavigationStackContext](file:///f:/local-media/frontend/src/contexts/NavigationStackContext.tsx)**:
   - Maintains an in-memory stack of route visits.
   - Restores scroll position and query states when navigating back/forward.
2. **[AudioPreferenceProvider](file:///f:/local-media/frontend/src/contexts/AudioPreferenceProvider.tsx)**:
   - Stores user's global volume and mute preference in `localStorage`.
   - Synchronizes volume across `<video>` players and MPV controller.

---

## 4. Frontend Performance Guidelines

1. **Incremental / Paginated Data**:
   - Never load an entire media library into React state. Use `page` and `pageSize` parameters via [useInfiniteFeed](file:///f:/local-media/frontend/src/hooks/useInfiniteFeed.ts).
   - Feed requests must pass `exclude_ids` to avoid duplicate items in memory.
2. **Autoplay with IntersectionObserver**:
   - In [ReelsFeed.tsx](file:///f:/local-media/frontend/src/components/ReelsFeed.tsx) and [useIntersectionAutoplay.ts](file:///f:/local-media/frontend/src/hooks/useIntersectionAutoplay.ts), only the currently centered element plays video; offscreen videos are paused to preserve GPU memory and CPU cycles.
3. **Thumbnail Caching**:
   - Always load thumbnails via `/api/media/{id}/thumbnail` rather than rendering full video frames or full-resolution images directly in grid/feed cards.
4. **Stable Handler Subscriptions**:
   - Clean up event listeners in `useEffect` returns, especially IPC subscriptions (`window.localfeed.mpv.onStatus`).
