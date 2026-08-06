# Scan Performance Analysis

Date: 2026-08-07  
Scope: `backend/app/scanner.py`, `backend/app/db.py`, `backend/app/thumbnails.py`, scan API, and scan-status UI

Implementation status: the Phase 1 scanner optimizations described below are now implemented in the working tree.

## Executive summary

The scan is slow mainly because changed media is processed serially and each processed file performs expensive work in the foreground:

1. Every video launches a separate `ffprobe` process.
2. Every file opens a new SQLite connection and commits independently.
3. Folder paths are looked up in SQLite repeatedly instead of being cached.
4. Metadata extraction is single-threaded.
5. The scanner first builds a complete in-memory file list and then walks it synchronously.

The configured `D:\Torrent` root currently contains 1,812 recognized media files: 1,528 videos (about 185.74 GB) and 284 images (about 0.02 GB). At that size, process startup and per-file transaction overhead can dominate the initial scan. A rescan should be much faster when files are unchanged because the current code does skip metadata extraction for unchanged rows, but it still traverses the complete directory tree and stats every candidate file.

Thumbnails are not the cause of scan latency: thumbnail generation is lazy and is not called by the scanner.

## Current scan flow

```text
recursive os.walk()
        |
        v
collect every media path into a list
        |
        v
load all existing DB rows
        |
        v
for each file, serially:
  stat file
  compare modification time
  if changed:
    run ffprobe or Pillow
    open SQLite connection
    find/upsert folder
    insert/update media row
    commit and close connection
        |
        v
recalculate every folder's item_count
```

## Findings

| Priority | Finding | Evidence | Impact |
|---|---|---|---|
| P0 | SQLite connection and transaction per processed file | `scanner.py:534-588`, `db.py:12-36` | Repeated connection setup, PRAGMAs, journal work, commits, and close operations. This is especially costly for thousands of files. |
| P0 | One `ffprobe` subprocess per changed video | `scanner.py:147-166` | Windows process creation plus probing is repeated serially. Video-heavy libraries pay this cost once per changed video. |
| P0 | Metadata work is strictly serial | `scanner.py:433-453` | Only one Pillow/`ffprobe` operation runs at a time, leaving available I/O and CPU capacity unused. |
| P1 | Folder lookup is repeated for every file | `scanner.py:296-331` | `_upsert_folder()` issues a `SELECT` for each path segment. Files sharing a directory repeat identical queries. |
| P1 | Incremental comparison uses only formatted mtime | `scanner.py:351-355`, `scanner.py:442-443` | File size is stored but not loaded or compared. A same-timestamp replacement can be missed, and a changed file still needs a stat call before it can be skipped. |
| P1 | Full directory traversal happens on every scan | `scanner.py:335-349` | Even a no-change rescan visits every directory and candidate file. This is unavoidable for a basic portable scanner, but a watcher can reduce later work. |
| P2 | Discovery creates a complete list before processing | `scanner.py:407-410` | Extra memory and delayed first results for large libraries. It is less important than the database and metadata costs. |
| P2 | `os.walk()` is used for discovery | `scanner.py:343` | `os.scandir()` can reduce Python-level overhead and can preserve cached directory-entry stat information. This is an optimization, not the main bottleneck. |
| P2 | Folder aggregate update scans all folder/media rows | `scanner.py:457-475` | It runs once per scan, so it is usually smaller than per-file work, but can become noticeable at very large scale. |

### 1. Per-file SQLite transactions are the clearest bottleneck

`_process_file()` calls `get_db()` for each insert or update. `get_db()` creates a connection, applies four connection-level settings, commits on exit, and closes the connection. The scanner therefore turns one logical scan into one SQLite transaction per processed file.

WAL mode is already enabled, which is useful for concurrent readers, but WAL does not remove the cost of thousands of writer commits. The correct improvement is to keep one writer connection for the scan and commit in batches, such as every 250–1,000 records. SQLite should still have one writer; metadata workers should not write directly.

### 2. `ffprobe` is expensive and is called serially

For each changed video, `_run_ffprobe()` starts `ffprobe` with `-show_format` and `-show_streams`, captures JSON, waits synchronously, and allows up to 30 seconds. The 30-second timeout is only a failure ceiling, but the process creation and media inspection cost occur for every changed video.

The initial scan has 1,528 videos in the configured root. The current loop cannot overlap these independent probes, so the total probe time is approximately the sum of all individual probe times.

Use a bounded worker pool for metadata extraction, then send completed metadata records to one batched SQLite writer. The worker count should be configurable and conservative because multiple probes can compete for the same disk. Start around 4 workers on HDD/network storage and benchmark 4, 6, and 8 before increasing it.

### 3. Folder upsert repeats work

`_upsert_folder()` walks from the root to the file's parent and queries `folders` by path for every segment. A library with many files in the same folder repeats the same query for every file. A per-scan `dict[str, int]` cache eliminates these repeated reads. The cache must be used by the single database writer so that folder creation and IDs remain ordered and consistent.

### 4. Rescans are incremental, but can be made safer and cheaper

The current code correctly avoids metadata extraction when the stored formatted modification time matches and the row is active. However, `_get_existing_paths()` does not load `file_size_bytes`, even though the field is stored. Load and compare both:

```text
path + modification timestamp + file size
```

Prefer a high-resolution timestamp (`st_mtime_ns`) or a numeric value rather than formatting every timestamp as a second-resolution string. This improves change detection and avoids unnecessary datetime formatting. Discovery can return a cached `DirEntry.stat()` result so later processing does not stat the file again.

### 5. Discovery and missing-file detection scale linearly

The scanner builds `all_files`, then builds `existing_paths_on_disk`, then compares every database row against it. This is linear and acceptable for a small library, but it requires all paths to remain in memory and means every scan still traverses the whole root. `os.scandir()` is a reasonable low-risk improvement.

For frequent scans, add a cross-platform file-watch abstraction later. A library such as `watchdog` can use native mechanisms where available (for example, inotify, FSEvents, or ReadDirectoryChangesW) while retaining a full-scan fallback. Do not make the core scanner depend on a Windows-only USN Journal if cross-platform support is planned.

### 6. UI polling is not the root cause

The frontend polls `/api/scan/status` every two seconds. This adds negligible work compared with `ffprobe` and SQLite commits. It can be improved later with server-sent events or a longer adaptive interval, but changing polling will not materially speed up the scan itself.

## Recommended implementation order

### Phase 1: highest return, cross-platform

1. Refactor the scan to use one SQLite writer connection with batched commits.
2. Add a per-scan folder ID cache.
3. Split metadata extraction from persistence. Run extraction in a bounded `ThreadPoolExecutor`; keep all SQLite writes in one writer path.
4. Load and compare both mtime and file size before probing.
5. Preserve metadata on probe failure where appropriate, instead of overwriting useful prior metadata with nulls.

### Phase 2: reduce discovery and memory overhead

1. Replace `os.walk()` with an `os.scandir()` generator that yields path plus stat information.
2. Process changed candidates as a stream or bounded queue rather than requiring the entire list before work starts.
3. Use parameterized/prepared statements and batch `executemany()` where the data shape allows it.
4. Revisit the folder aggregate update with a grouped SQL update or a dirty-folder set.

### Phase 3: fast ongoing updates

1. Introduce a `FileChangeProvider` interface.
2. Implement a portable watcher using `watchdog` or equivalent.
3. Keep periodic full reconciliation scans for correctness, missed events, and startup recovery.

## Target architecture

```text
File discovery / watcher
        |
        v
change detector: path + mtime_ns + size
        |
        v
bounded metadata worker pool
        |
        v
single SQLite writer + folder cache
        |
        v
batched commits and progress updates
```

This design is portable, avoids SQLite writer contention, and lets the expensive metadata work overlap while preserving transaction ordering.

## Expected improvement

The largest gains should come from batching SQLite writes and overlapping metadata extraction. Exact speedups require measurement on the target disk and media mix; the repository currently has no benchmark harness, so numeric multipliers should not be treated as guaranteed.

Expected relative effect:

- Initial video-heavy scan: likely substantially faster after batching plus bounded parallel probing.
- Unchanged rescan: already much faster than the initial scan because metadata is skipped; mtime/size caching and file watching reduce the remaining traversal cost.
- Image-heavy scan: batching and folder caching matter most; Pillow work is generally cheaper than video probing.
- Network/HDD storage: use fewer metadata workers to avoid making disk contention worse.
- SSD storage: a somewhat larger worker pool may help, but benchmark rather than assuming CPU count is optimal.

## Validation plan

Add timing counters before and after the refactor for these phases:

1. Directory discovery.
2. Candidate comparison/skips.
3. Metadata extraction, split by image and video.
4. Database write time and commit count.
5. Folder aggregate update.

Run at least these cases:

```text
1. Empty database, full library scan.
2. Immediate unchanged rescan.
3. One changed image and one changed video.
4. Bulk add of 100+ files in an existing folder.
5. Files removed or moved from a root.
6. Corrupt/unreadable media and a timed-out probe.
```

Record wall-clock duration, files/second, probe concurrency, DB commit count, error count, and final row counts. Verify that scan results and soft-deletion behavior are unchanged before raising worker counts.

## Additional correctness issues found during the performance review

- `_find_root()` reads the global `MEDIA_ROOTS` instead of the `roots` argument passed to `_do_scan()`. Custom-root scans can therefore resolve a wrong root or fail folder-relative calculations. Pass the selected root through the processing path or build a root resolver from the active roots.
- `_fmt_modified()` performs a separate `getmtime()` call after discovery. Returning stat information from discovery would remove a redundant filesystem call per candidate.
- The scan updates `files_new`/`files_updated` even if `_process_file()` encounters a database or filesystem error. Progress counters should distinguish attempted, persisted, skipped, and failed files.
- A background thread is started per API request, while the actual duplicate check occurs inside `run_scan()`. This is functionally safe, but a dedicated scan executor or a lock acquired in the router would avoid creating redundant threads under concurrent requests.

## Conclusion

Start with the database writer/transaction refactor, folder cache, and bounded metadata workers. These changes are platform-independent and directly address the cost paid per changed file. Then improve discovery and add a portable watcher. Leave platform-specific journals as optional adapters behind the watcher abstraction rather than making them part of the core scanner.
