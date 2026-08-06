my app is slow to scan how to fix that

The scan performance in this application is primarily constrained by four major architectural bottlenecks in

scanner.py and db.py:

1. Database Connections & Transactions Per File (Largest Bottleneck)

In \_do_scan(),

\_process_file opens a brand-new database connection and executes a transaction for every single file:

python

# scanner.py (lines 534-536)

with get_db() as conn:

root = \_find_root(file_path)

folder_id = \_upsert_folder(conn, folder_path, root)

...

Impact: Every call to get_db() in

db.py:L26-36 calls sqlite3.connect(), sets 4 SQLite PRAGMAs, executes INSERT/UPDATE, commits to disk, and closes the connection. Doing disk commits thousands of times sequentially causes severe disk I/O overhead.

2. Synchronous Subprocess Overhead for ffprobe

For video metadata extraction, \_extract_video_metadata() executes an external process:

python

# scanner.py (lines 147-166)

result = subprocess.run(

["ffprobe", "-v", "quiet", "-print_format", "json", ...],

capture_output=True,

timeout=30,

)

Impact: On Windows, spawning a new process via subprocess.run incurs a overhead of 50–200ms per invocation. If you have 1,000 video files, just spawning process handles takes 1–3 minutes, even before reading any file data. 3. Sequential Single-Threaded Execution

The scanning loop in

\_do_scan iterates sequentially through all media files on a single Python thread:

python

# scanner.py (lines 433-454)

for file_path in all_files:

...

\_process_file(file_path, file_modified, existing_id=...)

Impact: Metadata extraction (ffprobe for videos and Pillow EXIF extraction for photos) is I/O and CPU bound, but runs one file at a time without leveraging multi-threading or parallel worker pools. 4. Redundant Database Folder Lookup Queries

Every file calls \_upsert_folder(), which queries the SQLite folders table part-by-part for every path segment:

python

# scanner.py (lines 312-314)

row = conn.execute(

"SELECT id FROM folders WHERE path = ?", (path_str,)

).fetchone()

Impact: If a directory contains 5,000 photos, \_upsert_folder() performs 5,000 identical SELECT database queries for that exact same folder path instead of caching folder IDs in memory.
Recommended Solutions
Batch Database Transactions: Open a single database transaction or batch updates (e.g., commit every 100–500 items or once per scan completion).
Parallel Processing: Use concurrent.futures.ThreadPoolExecutor (or ProcessPoolExecutor) to extract metadata (ffprobe / Pillow) in parallel across multiple worker threads.
In-Memory Folder Cache: Maintain a dict[str, int] mapping folder path strings to folder_id during the scan to eliminate repeated SQL queries.

Your analysis is solid. These are exactly the kinds of bottlenecks that make media scanners feel slow. If I were optimizing this app, I'd tackle them in this order because the gains are very different.

Priority Change Expected improvement
⭐⭐⭐⭐⭐ Batch DB writes 5–20×
⭐⭐⭐⭐ Parallel metadata extraction 2–6×
⭐⭐⭐⭐ Folder cache Huge reduction in SQL queries
⭐⭐⭐ Replace repeated ffprobe process spawning 20–40% for video-heavy libraries
⭐⭐⭐ Incremental scanning Nearly instant rescans

1. Stop opening SQLite for every file

This is the biggest issue.

Current flow:

File 1
connect
insert
commit
close

File 2
connect
insert
commit
close

File 3
connect
insert
commit
close

That's thousands of filesystem operations.

Instead:

connect

BEGIN

for every file:
insert/update

COMMIT

close

Or:

commit every 500 files

This alone can reduce scan time dramatically.

Even better:

cursor.executemany(...)

instead of individual inserts.

2. Process metadata concurrently

Your current scanner is doing:

scan

file1
ffprobe
file2
ffprobe
file3
ffprobe

Modern CPUs have 8–24 logical cores.

Instead:

ThreadPoolExecutor

Worker1 -> ffprobe movie1
Worker2 -> ffprobe movie2
Worker3 -> ffprobe movie3
Worker4 -> ffprobe movie4

While one worker waits for disk or ffprobe, others continue.

Something like:

with ThreadPoolExecutor(max_workers=8) as executor:
executor.map(process_file, files)

works well because ffprobe is an external executable, so the GIL isn't much of a limitation.

3. Cache folders

Instead of

SELECT folder_id

5,000 times

do

folder_cache = {}

if folder not in folder_cache:
query sqlite
folder_cache[path] = id

Then every later lookup is

dict lookup

O(1)

instead of SQL.

4. Don't call ffprobe unless necessary

Many scanners waste time by probing files that haven't changed.

Compare:

path
mtime
size

If they're identical to the database:

skip ffprobe

This is one of the biggest wins for rescans.

5. Separate scanning from metadata extraction

A lot of media managers use a pipeline.

Instead of

discover
↓

extract metadata
↓

database

do

Discover files
│
▼
Queue changed files
│
▼
8 metadata workers
│
▼
Database writer

The UI can already show files while metadata continues loading.

6. Have only one database writer

SQLite performs best with a single writer.

Workers should not write directly.

Instead:

Worker1
Worker2
Worker3
Worker4
│
▼
Queue
│
▼
Database Thread

The DB thread batches writes:

500 rows

commit

500 rows

commit

This is much faster than multiple threads contending for the same database.

7. Use WAL mode

If you're not already:

PRAGMA journal_mode=WAL;

It improves concurrency and reduces locking.

8. Use os.scandir()

If you're using

os.walk()

or

Path.rglob()

switch to

os.scandir()

It avoids unnecessary stat() calls and is noticeably faster on large directories.

9. Generate thumbnails later

Don't make scanning wait for thumbnails.

Do this:

scan

↓

insert database

↓

UI shows library

↓

background workers create thumbnails

Plex, Jellyfin, Emby, and Immich all work this way.

10. Think like a media server

For the kind of app you're building, I'd structure it like this:

Scanner
│
▼
Find files
│
▼
Skip unchanged files
│
▼
Metadata Worker Pool (8 threads)
│
▼
Database Queue
│
▼
Single Database Writer
│
▼
Thumbnail Queue
│
▼
Thumbnail Workers

Then on future launches:

Read database

↓

Show media immediately

↓

Background scan only for changes

The app feels instant because it isn't rescanning everything before displaying content.

One more opportunity: use the filesystem's change journal

Since your app targets Windows, you can go beyond directory scanning entirely. Everything and many professional media managers use the NTFS USN Journal to detect added, removed, renamed, and modified files. After the initial scan, your app can update the database based only on filesystem changes instead of traversing the whole library again.

For a Windows-first media browser, my implementation priority would be:

Single SQLite connection + batched transactions (largest immediate gain)
Single DB writer thread + worker pool for metadata extraction
Folder ID cache and prepared SQL statements
Skip unchanged files using mtime and file size
Background thumbnail generation
USN Journal for near-instant incremental updates

That architecture is scalable enough to handle libraries with hundreds of thousands of photos and videos while keeping startup and rescans fast.

ince your app targets Windows, you can go beyond directory scanning entirely. Everything and many professional media managers use the NTFS USN Journal to detect added, removed, renamed, and modified files. After the initial scan, your app can update the database based only on filesystem changes instead of traversing the whole library again. For a Windows-first media browser, my implementation priority would be: 1. Single SQLite connection + batched transactions (largest immediate gain) 2. Single DB writer thread + worker pool for metadata extraction 3. Folder ID cache and prepared SQL statements 4. Skip unchanged files using mtime and file size 5. Background thumbnail generation 6. USN Journal for near-instant incremental updates That architecture is scalable enough to handle libraries with hundreds of thousands of photos and videos while keeping startup and rescans fast.

i intent to support all platform in the future should i do the suggestion then

Yes—but with one important design decision:

Don't build your architecture around the Windows USN Journal. Build around an abstraction that can use platform-specific optimizations.

Think of it like this:

Media Scanner
│
▼
File Change Provider (interface)
│
┌────┼───────────┐
│ │ │
▼ ▼ ▼
Windows macOS Linux
USN FSEvents inotify
Journal

Your scanner shouldn't know how changes are detected. It should just receive events like:

FileAdded(path)
FileRemoved(path)
FileModified(path)
FileRenamed(old, new)

Then each OS has its own implementation.

Platform equivalents
Platform Best option
Windows NTFS USN Journal
macOS FSEvents
Linux inotify
Android FileObserver
iOS FSEvents / NSFilePresenter

This is exactly how cross-platform sync apps like Dropbox, OneDrive, Syncthing, and Google Drive work.

What should you build now?
Definitely implement these (cross-platform)

✅ Single SQLite connection

✅ Batch transactions

✅ Thread pool

✅ Folder cache

✅ Skip unchanged files

✅ Background thumbnail generation

These are platform-independent and you'll benefit on every OS.

Delay these until later

❌ Windows USN Journal

❌ macOS FSEvents

❌ Linux inotify

Instead, initially do:

Initial scan

↓

Watch folders

↓

Rescan only changed directory

A cross-platform library can handle this.

For example:

Rust: notify
Node.js: chokidar
Python: watchdog

These use the native APIs internally where possible.

My recommendation

Since you've said this app is intended to be a polished, long-term project, I'd build it in phases.

Phase 1 (MVP)
Recursive scan
SQLite
Batch writes
Worker pool
Thumbnail queue
Incremental scan using mtime + file size

This gets you 90% of the performance improvement.

Phase 2
Real-time file watching (cross-platform)
Auto-update library when files change
Phase 3

Implement platform-specific backends:

Windows → USN Journal
Linux → inotify
macOS → FSEvents

The rest of your application won't need to change because it already talks to the FileChangeProvider interface.

This is the architecture I'd aim for
App
│
▼
Media Library Service
│
┌──────────┴──────────┐
│ │
▼ ▼
Scanner Change Provider
│ │
│ ┌──────────────┐
│ │ │
▼ ▼ ▼
SQLite Windows Linux/macOS
USN inotify/FSEvents

That keeps your core logic completely cross-platform while still letting each operating system use its fastest native file tracking mechanism. It's a clean design that will scale well as you add support for Windows, Linux, and macOS.
