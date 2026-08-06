# Project Prompt: "LocalFeed" — A Private Instagram/Reels-Style Browser for Local Media

---

## 1. Concept Summary

Build a **local-first, single-user web app** that turns a personal media collection (movies, TV
shows, clips, random videos, **and photos/images**) sitting on a laptop's file system into a
browsable, scrollable experience like Instagram/Reels — but entirely private, offline, and with
no social features (no likes, comments, followers, or sharing with other people).

The library is **mixed media**: videos and images live side by side, often in the same folders
(e.g. a trip folder with both photos and video clips). Both types must be first-class citizens
in the feed, grid, and folder views — not a bolted-on special case.

Core mental model:

- **A folder = a "profile"** (like an Instagram username). The folder name is the tag/creator
  name shown on each item.
- **Clicking a tag/profile** opens that folder's contents in a grid, like visiting a profile page.
- **The main feed** is a vertically swipeable, full-screen feed (like Reels) mixing photos and
  autoplaying videos, pulling items **randomly** from the whole library by default.
- **A secondary grid view** (like the Instagram grid) lets the user browse by folder/tag,
  duration, date added, etc.
- Recommendation/personalization is explicitly **out of scope for v1** — build the data model so
  it can be added later (watch events, watch duration, skip events should be logged from day one
  even if unused).

---

## 2. Tech Stack

- **Backend**: Python 3.11+, FastAPI, SQLite (via SQLAlchemy or raw `sqlite3`), `ffmpeg`/`ffprobe`
  (via subprocess) for video thumbnails/duration/metadata extraction, and `Pillow` (PIL) for
  image thumbnails/metadata/EXIF extraction.
- **Frontend**: React + Vite (TypeScript), CSS with scroll-snap for the reels feed. No heavy UI
  framework needed — keep it lightweight and fast.
- **Video serving**: FastAPI `StreamingResponse` with HTTP **Range request** support (critical —
  without this, seeking/scrubbing and instant playback won't work).
- **Image serving**: plain file/thumbnail responses (no range/streaming complexity needed) — see
  section 5.2b.
- **Local only**: runs on `localhost`, binds to `127.0.0.1` by default, no auth needed for v1
  (single user on their own machine), but structure the code so auth could be added later.

---

## 3. High-Level Architecture

```
/backend
  /app
    main.py                # FastAPI app entrypoint
    config.py               # library root path(s), thumbnail cache dir, db path
    db.py                    # SQLite connection/session
    models.py                 # SQLAlchemy models: MediaItem, Folder/Tag, WatchEvent
    scanner.py                # filesystem walker + ffprobe/Pillow metadata extraction
    thumbnails.py              # ffmpeg (video) + Pillow (image) thumbnail generation
    routers/
      media.py                 # list/filter/search endpoints, stream endpoint
      feed.py                    # random feed, grid feed, pagination/cursor logic
      folders.py                  # folder/tag listing + folder detail
      events.py                    # log watch/skip events (for future recs)
      scan.py                       # trigger rescan, scan status/progress
  requirements.txt
/frontend
  /src
    api/                     # typed fetch wrappers for backend endpoints
    components/
      ReelsFeed.tsx            # vertical snap-scroll full-screen video feed
      VideoCard.tsx             # single video player w/ autoplay-on-view logic
      GridFeed.tsx                # instagram-style grid of thumbnails
      FolderProfile.tsx            # folder/tag "profile page" view
      TopNav.tsx / BottomNav.tsx    # navigation between Feed / Explore / Folders
    hooks/
      useIntersectionAutoplay.ts   # play video when it's the one in viewport
      useInfiniteFeed.ts            # fetch more feed items as user scrolls
    App.tsx
  package.json
```

---

## 4. Data Model (SQLite)

**folders** (derived from directory structure, treated as "tags"/"profiles")

- `id`
- `name` (folder name, e.g. "The Office S3", "Vacation Clips 2023")
- `path` (absolute path)
- `parent_folder_id` (nullable, supports nested folders — e.g. TV Show > Season)
- `item_count`
- `cover_thumbnail_path` (auto-picked from a contained video)

**media_items**

- `id`
- `folder_id` (FK → folders — this is the "tag"/profile owner)
- `media_type` (`video` or `image` — set at scan time, drives how the frontend renders the card
  and which streaming endpoint is used)
- `filename`
- `path` (absolute path)
- `title` (defaults to filename, cleaned up — strip extensions, dots→spaces, resolution
  tags, etc.)
- `duration_seconds` (nullable — only set for `video`)
- `resolution` (e.g. "1920x1080" — set for both types)
- `codec` (nullable — only set for `video`)
- `orientation` (`landscape` / `portrait` / `square` — derived from resolution/EXIF, used to
  decide fit/crop behavior in the vertical feed for both photos and videos)
- `file_size_bytes`
- `thumbnail_path` (extracted video frame, or resized image thumbnail)
- `created_at` (row insert time)
- `file_modified_at` (from filesystem)
- `captured_at` (nullable — EXIF `DateTimeOriginal` for images when available; useful later for
  chronological sorting of photos, e.g. "on this day")
- `last_watched_at` (nullable — for images this doubles as "last viewed")
- `watch_count` (for images this doubles as "view count")
- `is_favorite` (bool, simple manual organization feature)
- `duration_watched_seconds` (cumulative, video only, for future "resume" + future recs)

**watch_events** (write-only log, for future recommendation engine — don't build the engine now,
just capture the data)

- `id`
- `media_item_id`
- `event_type` (`view_start`, `view_end`, `skip`, `favorite`, `open_from_grid`, `open_from_feed`)
- `watched_seconds` (how far they got, for `view_end`/`skip`)
- `timestamp`

Keep the schema forgiving — media libraries are messy. Scanner should not crash on weird
filenames, missing metadata, or corrupt files; log and skip instead.

---

## 5. Feature List — Phase 1 (Build This Now)

### 5.1 Library scanning

- Config file or `.env` lists one or more root directories to scan (e.g.
  `~/Movies`, `~/TVShows`, `~/Clips`, `~/Photos`) — video and image roots can be the same or
  different directories; the scanner shouldn't care, it classifies by file extension/content.
- Recursive scan for:
  - video files (`.mp4`, `.mkv`, `.mov`, `.avi`, `.webm`, etc.)
  - image files (`.jpg`/`.jpeg`, `.png`, `.heic`, `.webp`, `.gif`, etc.)
- For each new **video** file: extract duration/resolution/codec via `ffprobe`, generate a
  thumbnail (frame at ~10% into the video) via `ffmpeg`.
- For each new **image** file: extract resolution and EXIF `DateTimeOriginal` (if present) via
  Pillow, generate a resized thumbnail via Pillow. Note: `.heic` may need `pillow-heif` installed
  since stock Pillow doesn't decode it — flag this as a dependency to check for.
- Both types insert into `media_items` with the appropriate `media_type`, and upsert the
  containing folder into `folders` — folders are type-agnostic and can (and often will) mix
  photos and videos.
- Detect deleted/moved files on rescan (mark inactive rather than hard-delete, to preserve
  watch/view history).
- Expose `POST /api/scan` to trigger a rescan and `GET /api/scan/status` to poll progress —
  scanning should run as a background task, not block the API.
- Thumbnails and any generated sprite sheets get cached to disk (e.g.
  `~/.localfeed/thumbnails/`), keyed by file hash or id, so rescans don't redo work needlessly.

### 5.2 Video streaming

- `GET /api/media/{id}/stream` must support HTTP Range requests (206 Partial Content) so the
  `<video>` tag can seek and the browser doesn't have to download the whole file to start
  playback. Only applies when `media_type == video`.
- `GET /api/media/{id}/thumbnail` serves the cached thumbnail image (works for both types).

### 5.2b Image serving

- `GET /api/media/{id}/full` serves the full-resolution image file directly (no transcoding
  needed for common formats; for `.heic`, consider serving a converted JPEG since browser HEIC
  support is inconsistent — check via Pillow/pillow-heif and convert + cache on first request,
  same caching pattern as video transcoding).
- The feed and grid should use `thumbnail_path` for browsing and only fetch `/full` when an image
  is the actively-viewed card (same lazy-loading principle as video, just without the streaming
  complexity — images don't need Range requests since the whole file is small enough to load
  directly).

### 5.3 Reels-style vertical feed (the core experience — mixed photos + videos)

- `GET /api/feed/random?exclude_ids=...&limit=10` returns a randomized batch of media items of
  **either type**, mixed together (excluding ones already shown in this session, so scrolling
  doesn't repeat immediately).
- Frontend: full-viewport-height cards in a CSS scroll-snap vertical container
  (`scroll-snap-type: y mandatory`). Each card renders a `<video>` or an `<img>` depending on
  `media_type` — build a single `MediaCard` component that branches internally, rather than
  separate feed logic per type, so ordering/mixing "just works."
- **Video cards**: only the one centered in the viewport autoplays (muted-by-default with tap-
  to-unmute, like Reels/TikTok) — use an `IntersectionObserver` to detect which card is active
  and play/pause accordingly. Pause and reset all off-screen videos to avoid many videos decoding
  audio/video simultaneously.
- **Image cards**: since photos have no inherent duration, hold each on screen for a fixed dwell
  time before the UI _could_ auto-advance — but default to **not auto-advancing** (Instagram-
  style: the photo just sits there until the user swipes), since this is a personal browsing tool
  and auto-advancing photos can feel jarring. Leave a `dwellSeconds` constant in the code as an
  easy config point in case the user wants auto-advance later. Optionally support a subtle
  Ken-Burns pan/zoom on the image while it's active, since a fully static photo in a "reels" feed
  can feel dead — keep this simple/toggleable, not a hard requirement.
- Infinite scroll: when the user nears the end of the loaded batch, fetch another random batch
  from the backend and append.
- Each card overlays: folder/tag name (tappable → goes to folder profile), title, duration (video
  only), simple controls (mute toggle + progress bar for video; nothing needed for images beyond
  maybe a subtle "photo" indicator so the user knows not to expect motion), and a "favorite"
  button.
- Log a `view_start` event when a card becomes active and a `view_end`/`skip` event (with
  `watched_seconds` for video, or just elapsed on-screen time for images — reuse the same field)
  when it becomes inactive.

### 5.4 Grid / Explore view (Instagram-grid-style)

- `GET /api/media?sort=random|newest|oldest|duration|favorites&media_type=video|image|all&folder_id=&page=&page_size=`
- 3-column responsive thumbnail grid mixing photos and videos; give video thumbnails a small
  play-icon/duration badge overlay (like Instagram does) so the two types are visually
  distinguishable at a glance without opening them.
- Click opens either:
  - a full detail/player-or-viewer view, or
  - inserts into the reels feed starting at that item (recommended — keeps the experience
    consistent, and works for both types since `MediaCard` already branches on `media_type`).

### 5.5 Folder/Tag "profile" pages

- `GET /api/folders` — list of all top-level tags/folders with cover thumbnail + item count.
- `GET /api/folders/{id}` — folder detail: name, item count, grid of its media items, and (if it
  has subfolders, e.g. TV show seasons) a list of subfolders to drill into.
- Clicking a tag/folder name anywhere in the app (feed overlay, grid) navigates to this profile
  page — this is the "click the Instagram username" interaction the user described.

### 5.6 Basic organization tools

- Favorite/unfavorite a media item.
- Rename a folder's _display name_ without touching the actual filesystem path (store an
  optional `display_name` override on `folders`).
- Simple search bar: `GET /api/media?q=...` searching title/filename/folder name.

### 5.7 Navigation shell

- Bottom (mobile-style) or side nav with: **Feed** (reels), **Explore** (grid), **Folders**
  (tag list), **Favorites**, **Search**.

---

## 6. Explicitly Deferred to Phase 2 (do not build yet, but keep data model ready)

- Recommendation engine using `watch_events` (e.g. weighted-random based on folder affinity,
  watch completion rate, recency).
- Alternate sort/feed algorithms beyond pure random (e.g. "least recently watched first," "mix
  of new + favorites").
- Multi-user profiles / PINs.
- TV show season/episode-aware grouping beyond generic nested folders.

Note: transcoding is **not** deferred — see section 6a, it's required for v1 given the library's
scale and format mix.

### 6a. Scale & Format Notes (confirmed with user — read before building)

The user's library is **tens of thousands of files**, and **some are in old/unusual formats**
(e.g. `.avi`, `.wmv`) that browsers can't play natively via `<video>`. This has two concrete
consequences for how Phase 1 must be built — do not treat these as later polish:

**a) Playback compatibility (needed in v1, not v2)**

- On scan, use `ffprobe` to record each file's container/codec, and classify it as
  `browser_native` (e.g. H.264/AAC in mp4/webm, VP9/Opus in webm) or `needs_transcode`
  (e.g. most `.avi`, `.wmv`, older codecs like MPEG-4 Part 2, WMV3, etc.).
- For `needs_transcode` files, the stream endpoint should **transcode on the fly** with
  `ffmpeg` piped into a `StreamingResponse` (e.g. remux/transcode to H.264/AAC in an mp4/fMP4
  container), rather than requiring a full pre-conversion pass over the whole library. Cache the
  transcoded output to disk on first request (e.g. `~/.localfeed/transcoded/{id}.mp4`) so repeat
  views don't re-encode.
- On-the-fly transcoding won't support Range/seek as cleanly as native files — it's fine for v1
  to accept that seeking on transcoded files is best-effort (e.g. seek restarts the ffmpeg
  process from a keyframe near the requested offset) rather than instant. Note this as a known
  limitation in code comments.
- The frontend should treat this transparently — the player doesn't need to know whether a file
  is native or transcoded, it just hits `/api/media/{id}/stream`.

**b) Scale (tens of thousands of files) changes several "small library" assumptions**

- **Don't pre-generate thumbnails for the whole library synchronously.** Scan metadata
  (path/duration/codec/etc.) eagerly since it's cheap, but generate thumbnails **lazily on first
  request** (with disk caching) or via a low-priority background worker pool that runs
  continuously without blocking the API — a synchronous thumbnail pass over tens of thousands of
  files at scan time will make first-run unusable for a long time.
- **Index the right columns**: add SQLite indexes on `media_items.folder_id`,
  `media_items.file_modified_at`, and `folders.parent_folder_id` at minimum — random/paginated
  queries over tens of thousands of rows need these to stay fast.
- **Random feed at scale**: `ORDER BY RANDOM()` in SQLite is fine at hundreds/thousands of rows
  but degrades at tens of thousands+. Prefer selecting random `id`s via `WHERE id IN (random
sample of ids)` (e.g. pick N random ids from a lightweight `SELECT id FROM media_items`
  fetched once and cached in memory, refreshed periodically) rather than `ORDER BY RANDOM()` on
  every feed request.
- **Scan must be incremental and resumable.** With this many files, a full rescan needs to walk
  the filesystem, diff against existing DB rows by path + `file_modified_at`, and only touch
  changed/new files — not reprocess everything every time. Report progress (`files_scanned /
files_total`, `estimated_time_remaining`) via `/api/scan/status` so the UI can show a real
  progress bar instead of a spinner.
- **Pagination everywhere.** Grid/folder endpoints must use cursor or offset pagination with
  sane page sizes (e.g. 30–50 items) — never return the full library in one response.

---

## 7. Non-Functional Requirements

- **Privacy/local-only**: no telemetry, no external network calls except optional `ffmpeg`
  binary checks. Everything — DB, thumbnails, video files — stays on disk under user control.
- **Performance**: scanning a large library (thousands of files) must not block the UI; do it as
  a background task with progress reporting. Thumbnail generation (both ffmpeg for video and
  Pillow for images) should be parallelized with a bounded worker pool — image thumbnailing is
  much cheaper per-file than video, but at tens of thousands of photos it still adds up and
  should follow the same lazy/background approach as video thumbnails, not a blocking pass.
- **Resilience**: corrupt/unreadable files should not crash the scanner or the API; log and
  continue.
- **Config**: library root paths, host/port, and thumbnail cache location should be configurable
  via `.env`, not hardcoded.

---

## 8. Suggested Build Order (for the coding agent)

1. Scaffold FastAPI backend with SQLite models (`folders`, `media_items` with `media_type`,
   `watch_events`) and add the indexes noted in section 6a from the start (add `media_type` to
   the index list — feed/grid queries will frequently filter on it).
2. Build the filesystem scanner (metadata only — path, `media_type`, duration/codec for video,
   resolution/EXIF for images, `browser_native` vs. `needs_transcode` classification for video)
   as a standalone script first, verify against a small test folder that includes at least one
   native video format, one old video format (e.g. `.avi`/`.wmv`), and a couple of images (e.g.
   `.jpg` and `.heic` if you have any, to confirm the Pillow/pillow-heif path works).
3. Wrap scanning as an **incremental, resumable** background task exposed via `/api/scan` +
   `/api/scan/status` (diff by path + `file_modified_at`, report real progress).
4. Build lazy, on-demand thumbnail generation for both types (ffmpeg frame extraction for video,
   Pillow resize for images; generate + cache on first request; optionally also a slow background
   worker to pre-warm popular/recent folders) rather than a full synchronous pass.
5. Implement serving endpoints: video — native files served directly with Range support, files
   needing transcode served via on-the-fly `ffmpeg` piped output with disk caching; images —
   direct file serving for common formats, HEIC-to-JPEG conversion with caching if needed. Confirm
   both a `<video>` tag and an `<img>` tag work correctly before touching the frontend feed.
6. Build `media`, `feed`, and `folders` routers with pagination and the random-sampling
   approach from section 6a (not naive `ORDER BY RANDOM()`).
7. Scaffold React + Vite frontend; build `GridFeed` first (simpler, validates thumbnails/API
   wiring, and pagination behavior at scale).
8. Build `ReelsFeed` with scroll-snap + `IntersectionObserver` autoplay logic.
9. Build `FolderProfile` page and wire up tag-click navigation from both feed and grid.
10. Add favorites, search, and watch-event logging.
11. Polish: loading states, scan-progress UI, empty states, and graceful handling of files that
    fail to transcode/play (mark as broken rather than crashing the feed).

---

## 9. Confirmed Answers (from prior discussion with user)

- **Library size**: tens of thousands of files → drives the lazy-thumbnail, incremental-scan,
  id-sampled-random, and pagination-everywhere requirements in section 6a.
- **Old video formats present** (`.avi`, `.wmv`, etc.) → drives the required on-the-fly transcode
  path in section 6a.
- **Library also includes images**, mixed into the same folders as videos → drives `media_type`
  in the data model, Pillow-based scanning/thumbnailing, the image serving endpoint in 5.2b, and
  the mixed-pacing behavior in the reels feed (5.3).

## 10. Open Questions Still to Resolve Before/During Build

- Where does the media library actually live on disk (single root vs. multiple separate roots
  for videos vs. photos)? multiple roots for videos and photos
- Roughly how large is the collection (hundreds vs. tens of thousands of files) — affects how
  aggressive thumbnail pre-generation should be vs. on-demand/lazy generation.
  lot of videos and photos on-demand/ lazy generate
- Any known problematic file formats already in the collection (very old `.avi`/`.wmv` that
  browsers can't play natively) — determines whether a transcode fallback is needed even in v1.
  yes it has old formats.

- Any HEIC files in the collection (common from iPhone exports)? If yes, `pillow-heif` needs to
  be added as a dependency and installed alongside Pillow.
  yes
- Any animated GIFs in the collection? If yes, decide whether they should behave like images
  (static thumbnail, tap to view) or like short autoplaying videos in the feed — worth deciding
  explicitly rather than letting it fall out of whichever code path happens to catch `.gif`.
  they should behave like videos.
