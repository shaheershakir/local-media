# LocalFeed Playback Architecture

This document details the video and image playback subsystem in LocalFeed, including the decision tree, streaming pipelines, seeking semantics, MPV integration, and known failure modes.

---

## 1. Overview & Architecture

LocalFeed is a local-only media browser designed for smooth playback across both modern web-friendly formats and legacy desktop video containers. Playback is handled through three primary pathways:

```text
                                  Media File
                                      │
                   Is Browser-Native (Container + Codec)?
                                 /          \
                               YES           NO
                              /                \
                Native HTML5 Stream        Needs Transcode / MPV
               (HTTP 206 Range)            /                   \
                      │          Live FFmpeg Pipe          Embedded MPV
                      │         (Fragmented MP4)         (Native IPC / --wid)
                      │                   │                       │
                      ▼                   ▼                       ▼
            <VideoPlayer> / <CustomCinemaPlayer>          Native Window / React Overlay
```

---

## 2. Playback Decision Tree

When a video item is requested in the frontend:

1. **Browser-Native Path** (`browser_native == 1`):
   - **Condition**: Container is in `BROWSER_NATIVE_CONTAINERS` (`mp4`, `webm`, `mov`, `m4v`, `ogv`, `ogg`, `mkv`) AND video codec is in `BROWSER_NATIVE_CODECS` (`h264`, `avc1`, `hevc`, `h265`, `vp8`, `vp9`, `av1`, `theora`) AND audio codec is in `BROWSER_NATIVE_AUDIO_CODECS` (`aac`, `mp3`, `opus`, `vorbis`, `flac`, `pcm_s16le`, `pcm_s24le`, `""`).
   - **Pipeline**: Streamed directly via `/api/media/{id}/stream` with standard HTTP 206 Partial Content (Range requests).
   - **Player**: Rendered in HTML5 `<video>` elements inside [VideoPlayer.tsx](file:///f:/local-media/frontend/src/components/VideoPlayer.tsx) or [CustomCinemaPlayer.tsx](file:///f:/local-media/frontend/src/components/CustomCinemaPlayer.tsx).

2. **Completed Transcode Path**:
   - **Condition**: A previously generated transcode file exists on disk in `TRANSCODED_DIR/{id}.mp4`.
   - **Pipeline**: Served directly as an H.264/AAC MP4 with HTTP 206 Range support.

3. **Live Transcode Path (On-the-fly streaming)**:
   - **Condition**: Non-native format (e.g. `avi`, `wmv`, `flv`, `mpg`, `vob`, `3gp`, `divx`, or non-native codecs) AND transcode not yet finished on disk.
   - **Pipeline**: Backend spawns an `ffmpeg` process streaming fragmented MP4 (`fMP4`) to `stdout` (`pipe:1`), piped immediately to FastAPI `StreamingResponse`. In parallel, a background thread queues full transcode to disk cache.
   - **Player**: Rendered in HTML5 `<video>` using the live stream URL.

4. **MPV Native Player Path**:
   - **Condition**: User switches to MPV or MPV mode is triggered.
   - **Pipeline**: Native file path is passed via Electron IPC directly to `node-mpv`. MPV attaches to Electron's window handle (`--wid`) or runs as a dedicated player while React controls transport via IPC.

---

## 3. Seeking Semantics & Range Requests

Seeking behaves differently depending on whether the stream is Range-based or live-transcoded:

### A. Range-Based Seeking (Native & Completed Transcodes)

1. The browser emits an HTTP request with a `Range` header, e.g.:
   ```http
   GET /api/media/42/stream HTTP/1.1
   Range: bytes=1048576-2097151
   ```
2. `_serve_file_with_range` in [backend/app/routers/media.py](file:///f:/local-media/backend/app/routers/media.py) parses the byte offsets.
3. The server responds with `HTTP/1.1 206 Partial Content`, supplying:
   - `Content-Range: bytes 1048576-2097151/52428800`
   - `Content-Length: 1048576`
   - `Accept-Ranges: bytes`
4. The client's HTML5 media pipeline reads byte chunks via `_file_chunk_generator` without restarting playback.

### B. Live Transcode Seeking (Legacy Formats)

Live `fMP4` streams cannot satisfy arbitrary byte-range requests because the complete file does not yet exist and byte offsets do not map linearly to timestamps.

1. Seeking in a live stream is done by timestamp rather than byte range using query parameters:
   ```text
   GET /api/media/42/stream?t=45.5
   // or
   GET /api/media/42/stream?seek=45.5
   ```
2. The backend receives `t` or `seek` and starts `ffmpeg` with `-ss <seconds>` placed **before** the input flag `-i` for fast keyframe-level input seeking:
   ```bash
   ffmpeg -fflags +genpts+discardcorrupt -err_detect ignore_err -ss 45.500 -i input.avi \
     -c:v libx264 -preset ultrafast -tune zerolatency -crf 26 \
     -g 30 -keyint_min 30 -sc_threshold 0 -pix_fmt yuv420p \
     -vf scale=trunc(iw/2)*2:trunc(ih/2)*2 \
     -c:a aac -b:a 128k -ar 44100 -ac 2 -sn -dn \
     -max_muxing_queue_size 1024 \
     -movflags frag_keyframe+empty_moov+default_base_moof \
     -frag_duration 500000 -f mp4 pipe:1
   ```
3. Headers returned for live transcode:
   - `Cache-Control: no-cache, no-store`
   - `Accept-Ranges: none`
   - `X-Playback-Mode: live-transcode`
   - `X-Seek-Offset: 45.5`

> [!IMPORTANT]
> Never attempt to "fix" seek bugs by stripping query parameters or forcing `Accept-Ranges: bytes` onto a live stream pipe. Doing so breaks fragmented MP4 streaming.

---

## 4. MPV Integration & Synchronization

The MPV subsystem provides hardware-accelerated playback for complex codecs and legacy formats directly through the native MPV binary.

```text
[ React UI: CustomCinemaPlayer / MpvFloatingControl ]
                 │                  ▲
           IPC Commands        IPC Status / TimePosition
                 │                  │
                 ▼                  │
      [ electron/preload.ts: window.localfeed.mpv ]
                 │                  ▲
             ipcRenderer         ipcMain
                 │                  │
                 ▼                  │
        [ electron/main.ts / electron/mpv.ts ]
                 │
            MPV Controller (node-mpv JSON IPC socket)
                 │
                 ▼
         Native MPV Binary (embedded via --wid or borderless)
```

### IPC Channel Contract

| IPC Channel | Direction | Payload | Description |
|---|---|---|---|
| `mpv:is-available` | Invoke -> Promise | void | Checks if MPV binary is found on system |
| `mpv:get-status` | Invoke -> Promise | void | Returns current `MpvStatusData` snapshot |
| `mpv:play` | Invoke -> Promise | `{ filePath, meta }` | Loads media path with optional initial timestamp/volume |
| `mpv:pause` | Invoke -> Promise | void | Pauses MPV playback |
| `mpv:resume` | Invoke -> Promise | void | Resumes MPV playback |
| `mpv:toggle-pause` | Invoke -> Promise | void | Toggles playback state |
| `mpv:stop` | Invoke -> Promise | void | Stops and clears current track |
| `mpv:seek` | Invoke -> Promise | `seconds: number` | Relative seek by delta seconds |
| `mpv:go-to-position`| Invoke -> Promise | `seconds \| { seconds, exact }` | Absolute seek to target timestamp |
| `mpv:set-volume` | Invoke -> Promise | `volume: number` | Sets volume (0-100) |
| `mpv:toggle-mute` | Invoke -> Promise | void | Toggles audio mute |
| `mpv:status` | Event -> Renderer | `MpvStatusData` | Realtime status push on state change |
| `mpv:timeposition` | Event -> Renderer | `{ currentTime, duration }` | Throttled playback position updates |

---

## 5. Known Failure Modes & Diagnostic Rules

### Failure Mode 1: Legacy Video Seek Always Restarts from 0:00
- **Symptoms**: Scrubbing an AVI or WMV video in the web player immediately jumps back to the start.
- **Root Cause**: The player changed `video.currentTime` without updating the stream URL with `?t=<seconds>`, causing the browser to re-request the unseekable live stream from byte 0.
- **Correct Fix**: In live transcode mode, reload the stream source `src="/api/media/{id}/stream?t={newTime}"` and listen for `loadeddata`.

### Failure Mode 2: HTTP 416 Range Not Satisfiable
- **Symptoms**: Video stalls or fails to load when seeking near the end of a file.
- **Root Cause**: Requested `start >= file_size` or malformed range header parsing.
- **Correct Fix**: Verify `_parse_range_header` returns valid byte bounds `[0, file_size - 1]` and returns `Content-Range: bytes */{file_size}` on 416 errors.

### Failure Mode 3: Missing Video Duration on Initial Load
- **Symptoms**: Progress bar length is 0 or NaN for newly scanned files.
- **Root Cause**: Fast scanner phase skipped duration probing to prioritize directory indexing speed.
- **Correct Fix**: Backend automatically triggers `_fast_probe_duration` during `GET /api/media/{id}` and updates the database row lazily.

### Failure Mode 4: MPV State Desynchronization
- **Symptoms**: React player shows paused while MPV continues playing audio, or volume sliders conflict.
- **Root Cause**: Listener detachment or missing IPC subscription cleanup during React component unmount.
- **Correct Fix**: Always use [useMpv](file:///f:/local-media/frontend/src/hooks/useMpv.ts) hook which cleans up `onStatus` and `onTimePosition` subscriptions on unmount.
