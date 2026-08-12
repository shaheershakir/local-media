# REST API Specification

This document describes all REST API endpoints provided by the FastAPI backend (`backend/app/routers/`) and maps them to their consuming frontend modules in `frontend/src/api/`.

---

## 1. Base URL & Protocol

The backend runs on loopback `127.0.0.1:8000`.

- **In Electron**: The preload script exposes `window.localfeed.apiBaseUrl` (`http://127.0.0.1:8000/api`).
- **In Browser (Vite dev)**: Requests to `/api` are handled via Vite proxy or fallback configuration in [frontend/src/api/client.ts](file:///f:/local-media/frontend/src/api/client.ts).

---

## 2. API Endpoints Reference

### Health Check

```http
GET /api/health
```
- **Description**: Verifies backend readiness during Electron startup.
- **Response**: `200 OK`
  ```json
  { "status": "ok", "app": "LocalFeed" }
  ```

---

### Media Endpoints (`/api/media`)

Handled by [backend/app/routers/media.py](file:///f:/local-media/backend/app/routers/media.py).
Frontend Consumer: [frontend/src/api/media.ts](file:///f:/local-media/frontend/src/api/media.ts).

#### `GET /api/media`
- **Description**: Returns paginated list of media items with sorting and filtering.
- **Query Parameters**:
  - `sort`: `"newest"` | `"oldest"` | `"duration"` | `"favorites"` | `"random"` | `"name"` (default: `"newest"`)
  - `media_type`: `"video"` | `"image"` | `null` (optional)
  - `folder_id`: integer (includes descendants recursively)
  - `q`: string (search query matching title, filename, or folder name)
  - `favorites_only`: boolean (default: `false`)
  - `page`: integer `>= 1` (default: `1`)
  - `page_size`: integer `1-100` (default: `30`)
- **Response**: `200 OK`
  ```json
  {
    "items": [
      {
        "id": 1,
        "folder_id": 4,
        "media_type": "video",
        "filename": "clip.mp4",
        "path": "D:/Videos/clip.mp4",
        "title": "clip",
        "duration_seconds": 45.2,
        "codec": "h264",
        "browser_native": 1,
        "resolution": "1920x1080",
        "orientation": "landscape",
        "file_size_bytes": 10485760,
        "thumbnail_path": "C:/Users/.../thumbnails/1.jpg",
        "created_at": "2026-08-12T10:00:00Z",
        "file_modified_at": "2026-08-10T12:00:00Z",
        "watch_count": 3,
        "is_favorite": 0,
        "folder_label": "Vacation"
      }
    ],
    "total": 150,
    "page": 1,
    "page_size": 30,
    "pages": 5
  }
  ```

#### `GET /api/media/{id}`
- **Description**: Returns full metadata for a single media item. Missing video durations are lazily probed and saved.
- **Response**: `200 OK` (MediaItem object) or `404 Not Found`.

#### `PATCH /api/media/{id}`
- **Description**: Update mutable media attributes (`is_favorite`, `title`).
- **Body**:
  ```json
  { "is_favorite": true, "title": "New Title" }
  ```
- **Response**: `200 OK` `{"status": "ok"}`

#### `GET /api/media/{id}/thumbnail`
- **Description**: Serves cached JPEG thumbnail. If missing on disk, generates thumbnail lazily from image/video.
- **Response**: Binary JPEG (`image/jpeg`) with `Cache-Control: public, max-age=86400`.

#### `GET /api/media/{id}/full`
- **Description**: Serves full-resolution image. Converts HEIC/HEIF images to JPEG on the fly and caches result.
- **Response**: Binary image file.

#### `GET /api/media/{id}/stream`
- **Description**: Video streaming endpoint. Supports HTTP 206 Range requests for browser-native and completed transcodes; returns fragmented MP4 live stream for legacy files.
- **Query Parameters (Live Transcode Only)**:
  - `t` or `seek`: float seconds to start transcoding from.
- **Headers**:
  - Native/Range: `Accept-Ranges: bytes`, `Content-Range: bytes <start>-<end>/<total>`
  - Live Transcode: `X-Playback-Mode: live-transcode`, `X-Seek-Offset: <sec>`, `Accept-Ranges: none`

#### `GET /api/media/{id}/transcode-status`
- **Description**: Returns current transcoding status for a media item.
- **Response**:
  ```json
  { "id": 1, "status": "native" | "ready" | "transcoding" | "pending" | "failed" }
  ```

---

### Feed Endpoints (`/api/feed`)

Handled by [backend/app/routers/feed.py](file:///f:/local-media/backend/app/routers/feed.py).
Frontend Consumer: [frontend/src/api/media.ts](file:///f:/local-media/frontend/src/api/media.ts).

#### `GET /api/feed/random`
- **Description**: Returns a randomized batch of media items using an in-memory ID sampling pool for high throughput.
- **Query Parameters**:
  - `limit`: integer `1-50` (default: `10`)
  - `exclude_ids`: comma-separated integers (e.g. `"1,4,12"`)
  - `media_type`: `"video"` | `"image"` | `null`
- **Response**: `200 OK`
  ```json
  {
    "items": [ /* MediaItem[] */ ],
    "total_available": 540
  }
  ```

---

### Folders Endpoints (`/api/folders`)

Handled by [backend/app/routers/folders.py](file:///f:/local-media/backend/app/routers/folders.py).
Frontend Consumer: [frontend/src/api/folders.ts](file:///f:/local-media/frontend/src/api/folders.ts).

#### `GET /api/folders`
- **Description**: List folders. If `parent_id` is omitted, returns top-level folders.
- **Query Parameters**:
  - `parent_id`: integer (optional)
  - `page`: integer `>= 1`
  - `page_size`: integer `1-200`
- **Response**: `200 OK` `{"items": [...], "total": 12, "page": 1, "pages": 1}`

#### `GET /api/folders/{id}`
- **Description**: Returns folder metadata, paginated media items in this folder and subfolders, and direct child folders.
- **Query Parameters**: `page`, `page_size`, `sort`

#### `PATCH /api/folders/{id}`
- **Description**: Update user-editable folder `display_name`.
- **Body**: `{"display_name": "My Custom Folder Name"}`

---

### Scan Endpoints (`/api/scan`)

Handled by [backend/app/routers/scan.py](file:///f:/local-media/backend/app/routers/scan.py).
Frontend Consumer: [frontend/src/api/scan.ts](file:///f:/local-media/frontend/src/api/scan.ts), [useScanStatus.ts](file:///f:/local-media/frontend/src/hooks/useScanStatus.ts).

#### `POST /api/scan`
- **Description**: Starts an asynchronous background filesystem scan over configured `MEDIA_ROOTS`.
- **Response**: `{"status": "started" | "already_running", "message": "..."}`

#### `GET /api/scan/status`
- **Description**: Polls current scan state.
- **Response**: `200 OK`
  ```json
  {
    "running": true,
    "phase": "indexing" | "metadata" | "complete" | "idle",
    "items_discovered": 1240,
    "items_scanned": 850,
    "current_path": "D:/Videos/Vacation",
    "elapsed_seconds": 14.2,
    "errors": []
  }
  ```

---

### Sources Endpoints (`/api/sources`)

Handled by [backend/app/routers/sources.py](file:///f:/local-media/backend/app/routers/sources.py).
Frontend Consumer: [frontend/src/api/sources.ts](file:///f:/local-media/frontend/src/api/sources.ts).

#### `GET /api/sources`
- **Description**: Returns all configured source directories with status and media counts.

#### `POST /api/sources`
- **Description**: Adds a new media folder path to configuration. Updates `.env` and hot-reloads runtime `MEDIA_ROOTS`.
- **Body**: `{"path": "D:/Photos"}`

#### `DELETE /api/sources`
- **Description**: Removes a media root directory from configuration.

---

### Events Endpoints (`/api/events`)

Handled by [backend/app/routers/events.py](file:///f:/local-media/backend/app/routers/events.py).
Frontend Consumer: [frontend/src/api/recommendations.ts](file:///f:/local-media/frontend/src/api/recommendations.ts).

#### `POST /api/events`
- **Description**: Asynchronously logs media engagement events (fire-and-forget). Updates watch counters on `view_end`.
- **Body**:
  ```json
  {
    "media_item_id": 42,
    "event_type": "view_start" | "view_end" | "skip" | "favorite" | "open_from_grid" | "open_from_feed",
    "watched_seconds": 18.5
  }
  ```
