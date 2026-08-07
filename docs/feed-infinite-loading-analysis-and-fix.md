# Feed Infinite Loading Issue & Resolution (Electron Desktop App)

## Overview
In the LocalFeed Electron desktop application, scrolling through videos in the vertical Reels Feed causes the feed and API requests to enter an infinite loading state (`LOADING FEED...`). When this occurs, subsequent API calls (including `/api/feed/random` and media thumbnails in the Explore tab) hang indefinitely in `Pending` state.

---

## Technical Root Cause Analysis

### 1. Electron / Chromium Socket Pool Starvation (6 Concurrent Connections per Host)
- The Electron renderer runs on Chromium's network stack, which enforces a hard limit of **6 concurrent HTTP/1.1 connections** per origin (`http://127.0.0.1:8000`).
- In `MediaCard.tsx`, every card in the feed was rendering an active HTML5 video element:
  ```tsx
  <video
    ref={videoRef}
    className="reel-media-video"
    src={streamUrl(item.id)}
    preload="auto"
  />
  ```
- Because all cards appended to the feed stayed mounted with `preload="auto"` and active `src` attributes, each card established and held open a long-lived HTTP `206 Partial Content` streaming connection with the local FastAPI backend.
- Once the user scrolled past 6 video cards, all 6 available TCP sockets to `127.0.0.1:8000` were permanently consumed.
- When `useInfiniteFeed` reached the prefetch threshold (`items.length - index <= 3`) and called `fetch('/api/feed/random')`, the Electron network scheduler queued this HTTP request in `Pending` state waiting for an open connection slot.
- Because off-screen video elements never released their `src` or closed their HTTP streams, no socket was ever released, resulting in a complete and permanent API deadlock.

```
┌────────────────────────────────────────────────────────────────────────┐
│                   Electron Chromium Network Stack                      │
│                  Origin: http://127.0.0.1:8000 (Max 6)                 │
├────────────────────────────────────────────────────────────────────────┤
│ Socket 1: Card 0 Video Stream [206 Partial Content - Active/Open]     │
│ Socket 2: Card 1 Video Stream [206 Partial Content - Active/Open]     │
│ Socket 3: Card 2 Video Stream [206 Partial Content - Active/Open]     │
│ Socket 4: Card 3 Video Stream [206 Partial Content - Active/Open]     │
│ Socket 5: Card 4 Video Stream [206 Partial Content - Active/Open]     │
│ Socket 6: Card 5 Video Stream [206 Partial Content - Active/Open]     │
├────────────────────────────────────────────────────────────────────────┤
│ ⛔ QUEUE (BLOCKED): GET /api/feed/random?limit=10                      │
│ ⛔ QUEUE (BLOCKED): GET /api/media/23/thumbnail                        │
│ ⛔ QUEUE (BLOCKED): GET /api/media/45/thumbnail                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 2. Unbounded `exclude_ids` Growth & Query String Explosion
- `useInfiniteFeed.ts` was accumulating every seen item ID in `shownIds.current` and appending all of them as comma-separated values in the GET query string:
  ```
  GET /api/feed/random?limit=10&exclude_ids=1,2,3,4,5,6,7,8,9,10,11,12...
  ```
- As the user continued scrolling, the URL length grew to thousands of characters, increasing request parsing overhead and risking HTTP 414 / header overflow errors.

### 3. Infinite Re-Fetch Loop on Library Exhaustion
- In `backend/app/routers/feed.py`, when all available items had been excluded, the backend returned random samples from the full pool.
- Because those IDs were already in `shownIds.current`, the frontend filtered them out (`newItems.length === 0`), causing `useInfiniteFeed` to clear `shownIds` and immediately issue another recursive `getRandomFeed()` call while `loadingRef.current` remained locked or spinning.

---

## Solution & Architecture Fix

### 1. Proximity-Based Virtual Video Mounting (Socket Pool Protection)
- **Active Card Proximity Window**:
  - Only the currently active card (`isActive`) and at most the immediate adjacent cards (`Math.abs(index - activeIndex) <= 1`) are permitted to attach the `<video src="...">` streaming URL.
  - Off-screen cards (`Math.abs(index - activeIndex) > 1`) detach the `src` attribute and display a lightweight thumbnail image (`thumbnailUrl(item.id)`).
- **Explicit Socket Teardown on Inactive**:
  - When a video card scrolls out of view (`isActive === false`), it immediately pauses playback, cleans up the video element buffer (`video.removeAttribute('src'); video.load()`), and releases the TCP socket back to Electron's connection pool.

### 2. Sliding-Window Bounded Exclusion
- In `useInfiniteFeed.ts`, replace the unbounded `Set<number>` with a bounded sliding window (e.g., last 20–30 viewed items).
- This ensures URLs remain small, clean, and fast, while still preventing immediate item repetition during standard feed navigation.

### 3. Non-Blocking Infinite Feed State Machine
- Guard `fetchBatch` with an atomic `isFetching` flag and prefetch cooldown timer.
- When all media items in a small library have been displayed, gracefully append the fresh loop batch without getting trapped in an empty `newItems` recursive loop.

### 4. Backend Stream Resilience & Keep-Alive Optimization
- In `backend/app/routers/media.py`, ensure `_serve_file_with_range` sets proper `Accept-Ranges: bytes` and `Cache-Control` headers so Electron can reuse cached chunks efficiently.
- In `backend/app/routers/feed.py`, ensure sampling gracefully handles edge cases where total available items are smaller than the requested batch limit.

---

## Implementation Checklist

| Component | Target File | Description |
|---|---|---|
| **Video Lifecycle** | `frontend/src/components/MediaCard.tsx` | Detach `src` and release TCP sockets for off-screen cards; mount video only within `[-1, +1]` of `activeIndex`. |
| **Feed Hook** | `frontend/src/hooks/useInfiniteFeed.ts` | Bounded sliding window for `exclude_ids`, robust loop reset handling, and fetch locking. |
| **Feed Container** | `frontend/src/components/ReelsFeed.tsx` | Propagate `activeIndex` to cards for proximity calculation, and fix loading indicator conditions. |
| **Feed API** | `backend/app/routers/feed.py` | Bounded ID sampling and graceful small-library pagination. |
| **Media Streaming** | `backend/app/routers/media.py` | Stream headers and disconnect cleanup. |
