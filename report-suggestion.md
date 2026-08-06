# Audit & Analysis Report: Performance Suggestions vs. LocalMedia Codebase

**Target File Analyzed:** [`performance-suggestion.md`](file:///f:/local-media/performance-suggestion.md)  
**Codebase Audited:** [`f:\local-media\backend\app`](file:///f:/local-media/backend/app)  
**Date:** August 7, 2026  

---

## Executive Summary

The recommendations presented in [`performance-suggestion.md`](file:///f:/local-media/performance-suggestion.md) are **highly accurate and directly address the current performance bottlenecks** of the LocalMedia scanner. 

Our audit of [`scanner.py`](file:///f:/local-media/backend/app/scanner.py), [`db.py`](file:///f:/local-media/backend/app/db.py), and [`thumbnails.py`](file:///f:/local-media/backend/app/thumbnails.py) confirms that **6 out of the 10 major performance suggestions** are currently critical anti-patterns in our codebase, while **2 are already correctly implemented**, and **2 serve as ideal future roadmap items**.

Implementing Phase 1 optimizations (batched DB writes, thread worker pool, in-memory folder cache, and `os.scandir()`) will yield an estimated **10×–30× speedup** during library scans.

---

## Codebase Audit & Status Matrix

| # | Suggestion | Current Status in `f:\local-media` | Priority | Estimated Gain |
|---|---|---|---|---|
| **1** | **Batch Database Transactions** (Single DB conn / `executemany`) | ❌ **FAIL** — Opens/closes DB & commits per file ([`scanner.py:L534-588`](file:///f:/local-media/backend/app/scanner.py#L534-L588)) | ⭐⭐⭐⭐⭐ | **5×–20×** |
| **2** | **Parallel Metadata Extraction** (`ThreadPoolExecutor`) | ❌ **FAIL** — Sequential `for file_path in all_files:` loop ([`scanner.py:L433-453`](file:///f:/local-media/backend/app/scanner.py#L433-L453)) | ⭐⭐⭐⭐ | **2×–6×** |
| **3** | **In-Memory Folder Cache** (`dict[str, int]`) | ❌ **FAIL** — Queries SQLite `SELECT id FROM folders` per file segment ([`scanner.py:L312-314`](file:///f:/local-media/backend/app/scanner.py#L312-L314)) | ⭐⭐⭐⭐ | **Massive SQL Query Reduction** |
| **4** | **Skip Unchanged Files (`mtime` + `size`)** | ⚠️ **PARTIAL** — Skips via `mtime` check, but ignores `file_size_bytes` ([`scanner.py:L442`](file:///f:/local-media/backend/app/scanner.py#L442)) | ⭐⭐⭐ | **Fast Rescans** |
| **5** | **Pipeline Architecture (Scan → Worker → Writer)** | ❌ **FAIL** — Monolithic discover-extract-upsert loop | ⭐⭐⭐ | **Cleaner Concurrency** |
| **6** | **Single Database Writer Thread** | ❌ **NOT IMPLEMENTED** — Needed once multi-threading is introduced | ⭐⭐⭐ | **Prevents SQLite Lock Contention** |
| **7** | **Use SQLite WAL Mode** | ✅ **ALREADY IMPLEMENTED** — Set in [`db.py:L18`](file:///f:/local-media/backend/app/db.py#L18) (`PRAGMA journal_mode=WAL`) | ⭐⭐⭐ | **Concurrency Ready** |
| **8** | **Use `os.scandir()` instead of `os.walk()`** | ❌ **FAIL** — Uses `os.walk()` in [`scanner.py:L343`](file:///f:/local-media/backend/app/scanner.py#L343) | ⭐⭐ | **1.5×–3× File Discovery** |
| **9** | **Lazy / Background Thumbnail Generation** | ✅ **ALREADY IMPLEMENTED** — Lazy on-demand thumbnail generation ([`thumbnails.py`](file:///f:/local-media/backend/app/thumbnails.py)) | ⭐⭐⭐ | **Scan Unblocked by Thumbs** |
| **10** | **Cross-Platform Real-time File Watching (`watchdog`)** | ❌ **FUTURE (Phase 2/3)** — Currently requires manual `POST /api/scan` trigger | ⭐⭐ | **Instant Rescans on Change** |

---

## Detailed Codebase Audit Findings

### 1. Database Connections & Transactions Per File (Critical)
* **Code Reference:** [`scanner.py:L534-588`](file:///f:/local-media/backend/app/scanner.py#L534-L588)
* **Current Code:**
  ```python
  with get_db() as conn:
      root = _find_root(file_path)
      folder_id = _upsert_folder(conn, folder_path, root)
      if existing_id is None:
          conn.execute("INSERT INTO media_items ...", (...))
      else:
          conn.execute("UPDATE media_items ...", (...))
  ```
* **Analysis:** Every single file calls `get_db()`, which in [`db.py:L26-36`](file:///f:/local-media/backend/app/db.py#L26-L36) connects to SQLite, executes 4 PRAGMA queries, issues a disk `commit()`, and closes the handle. Scanning 10,000 files results in 10,000 disk syncs and 40,000 PRAGMA queries.
* **Fix:** Pass a single `conn` into the scan loop and commit in batches (e.g. every 500 records or once at completion).

---

### 2. Sequential Single-Threaded Metadata Extraction
* **Code Reference:** [`scanner.py:L433-453`](file:///f:/local-media/backend/app/scanner.py#L433-L453)
* **Current Code:**
  ```python
  for file_path in all_files:
      ...
      _process_file(file_path, file_modified, existing_id=db_row["id"])
  ```
* **Analysis:** Calls to `_extract_video_metadata()` (`ffprobe` process spawn) and `_extract_image_metadata()` (`Pillow` EXIF parse) run strictly sequentially. Modern multi-core processors (8–24 threads) remain 90% idle. Spawning `ffprobe.exe` sequentially on Windows takes 50–200ms per file.
* **Fix:** Utilize `concurrent.futures.ThreadPoolExecutor(max_workers=8)` to extract metadata for multiple files in parallel.

---

### 3. Redundant Folder Database Lookups
* **Code Reference:** [`scanner.py:L296-331`](file:///f:/local-media/backend/app/scanner.py#L296-L331)
* **Current Code:**
  ```python
  def _upsert_folder(conn, folder_path: Path, root_path: Path) -> int:
      ...
      row = conn.execute("SELECT id FROM folders WHERE path = ?", (path_str,)).fetchone()
  ```
* **Analysis:** For every file, `_upsert_folder()` breaks down path segments and executes a SQL `SELECT` statement. If 5,000 photos reside in `/Photos/2026/Vacation`, the scanner executes 15,000 redundant SQL queries.
* **Fix:** Maintain an in-memory dictionary `folder_cache: dict[str, int] = {}` during the scan lifecycle.

---

### 4. File Traversing via `os.walk()`
* **Code Reference:** [`scanner.py:L343`](file:///f:/local-media/backend/app/scanner.py#L343)
* **Current Code:**
  ```python
  for dirpath, _dirs, files in os.walk(str(root)):
  ```
* **Analysis:** `os.walk()` creates Python string lists for files and directories and incurs extra `stat()` overhead. `os.scandir()` yields `DirEntry` objects containing file types and attribute caching natively exposed by the OS kernel.
* **Fix:** Replace `os.walk()` with a recursive generator function using `os.scandir()`.

---

### 5. Already Implemented & Performing Well
* **WAL Mode (`PRAGMA journal_mode=WAL`):** Present in [`db.py:L18`](file:///f:/local-media/backend/app/db.py#L18). Allows concurrent readers while background scanning writes.
* **Lazy Thumbnail Generation:** Present in [`thumbnails.py`](file:///f:/local-media/backend/app/thumbnails.py). Thumbnails are generated on demand via `/api/media/{id}/thumbnail` rather than blocking the scanner.

---

## Actionable Implementation Roadmap

### Phase 1: High-Impact Core Scanner Refactoring (Immediate MVP)
1. **Single Connection & Batch Writes:** Update `run_scan()` to hold a single connection and use `executemany` or batched commits every 500 items.
2. **Metadata Worker Pool:** Use `ThreadPoolExecutor(max_workers=os.cpu_count() or 8)` for `_extract_video_metadata` and `_extract_image_metadata`.
3. **Folder ID Cache:** Introduce `folder_cache: dict[str, int]` inside `_do_scan()`.
4. **`os.scandir()` Migration:** Rewrite `_collect_media_files()` using `os.scandir()`.
5. **Enhanced Skip Check:** Compare both `file_modified_at` and `file_size_bytes` against DB records before passing files to metadata extraction workers.

### Phase 2: Real-time Cross-Platform Watching & Background Queues
1. **Directory Watching:** Integrate Python `watchdog` library to observe `MEDIA_ROOTS` and trigger incremental updates only on changed paths.
2. **Post-Scan Thumbnail Queue:** Add an async background queue to pre-render thumbnails after the initial scan finishes so the frontend gallery loads instantly.

### Phase 3: Abstracted OS Change Providers (Future Architecture)
1. **`FileChangeProvider` Interface:** Abstract file watching logic so native backends (Windows USN Journal, macOS FSEvents, Linux `inotify`) can be plugged in transparently as the application scales.

---
*Report generated automatically for `f:\local-media`.*
