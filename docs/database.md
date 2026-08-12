# Database Architecture & Schema

This document details the SQLite database layer in LocalFeed, including schema design, table definitions, indexing strategy, lifecycle state management, and migration guidelines.

---

## 1. Engine & Storage Configuration

LocalFeed uses standard SQLite via Python's built-in `sqlite3` driver with a lightweight connection helper in [backend/app/db.py](file:///f:/local-media/backend/app/db.py). No heavyweight ORM is used to ensure maximum scan and query throughput.

- **Location**: Determined by `DB_PATH` environment variable.
  - Development default: `~/.localfeed/localfeed.db`
  - Packaged desktop default: `%APPDATA%\localfeed-desktop\localfeed.db`
- **Concurrency & WAL Mode**:
  ```sql
  PRAGMA journal_mode=WAL;       -- Allows concurrent reads during background scans
  PRAGMA synchronous=NORMAL;     -- High performance with crash safety
  PRAGMA foreign_keys=ON;        -- Enforces relational integrity and cascading deletes
  PRAGMA cache_size=-32000;      -- 32 MB in-memory page cache
  ```

---

## 2. Entity-Relationship Diagram

```text
┌───────────────────────────────┐
│            folders            │
├───────────────────────────────┤
│ id (PK)                       │
│ name                          │
│ display_name (user override)  │
│ path (UNIQUE)                 │
│ parent_folder_id (FK: self)   │◄────┐ (Hierarchical subfolders)
│ item_count                    │     │
│ cover_thumbnail_path          │     │
│ created_at                    │─────┘
└──────────────┬────────────────┘
               │ 1
               │
               │ N (ON DELETE CASCADE)
               ▼
┌───────────────────────────────┐
│          media_items          │
├───────────────────────────────┤
│ id (PK)                       │
│ folder_id (FK: folders.id)    │
│ media_type ('video'|'image')  │
│ filename                      │
│ path (UNIQUE)                 │
│ title                         │
│ duration_seconds              │
│ codec                         │
│ browser_native (0|1)          │
│ resolution                    │
│ orientation                   │
│ file_size_bytes               │
│ thumbnail_path                │
│ created_at                    │
│ file_modified_at              │
│ captured_at (EXIF date)       │
│ last_watched_at               │
│ watch_count                   │
│ is_favorite (0|1)             │
│ duration_watched_seconds      │
│ is_active (1=active, 0=moved) │
└──────────────┬────────────────┘
               │ 1
               │
               │ N (ON DELETE CASCADE)
               ▼
┌───────────────────────────────┐
│         watch_events          │
├───────────────────────────────┤
│ id (PK)                       │
│ media_item_id (FK: items.id)  │
│ event_type (view_start, etc.) │
│ watched_seconds               │
│ timestamp                     │
└───────────────────────────────┘
```

---

## 3. Schema Definitions & Indexes

### Table `folders`

```sql
CREATE TABLE IF NOT EXISTS folders (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    name                 TEXT    NOT NULL,
    display_name         TEXT,                        -- user-editable override
    path                 TEXT    NOT NULL UNIQUE,
    parent_folder_id     INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    item_count           INTEGER NOT NULL DEFAULT 0,
    cover_thumbnail_path TEXT,
    created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_path   ON folders(path);
```

### Table `media_items`

```sql
CREATE TABLE IF NOT EXISTS media_items (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id                INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    media_type               TEXT    NOT NULL CHECK(media_type IN ('video','image')),
    filename                 TEXT    NOT NULL,
    path                     TEXT    NOT NULL UNIQUE,
    title                    TEXT    NOT NULL,
    -- video fields
    duration_seconds         REAL,
    codec                    TEXT,
    browser_native           INTEGER NOT NULL DEFAULT 1,   -- 0 = needs transcode
    -- shared metadata
    resolution               TEXT,
    orientation              TEXT    CHECK(orientation IN ('landscape','portrait','square')),
    file_size_bytes          INTEGER,
    thumbnail_path           TEXT,
    -- timestamps
    created_at               TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    file_modified_at         TEXT,
    captured_at              TEXT,                         -- EXIF DateTimeOriginal
    last_watched_at          TEXT,
    -- engagement
    watch_count              INTEGER NOT NULL DEFAULT 0,
    is_favorite              INTEGER NOT NULL DEFAULT 0,
    duration_watched_seconds REAL    NOT NULL DEFAULT 0,
    -- lifecycle
    is_active                INTEGER NOT NULL DEFAULT 1    -- 0 = file deleted/moved
);

CREATE INDEX IF NOT EXISTS idx_media_folder_id     ON media_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_media_file_modified ON media_items(file_modified_at);
CREATE INDEX IF NOT EXISTS idx_media_type          ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_media_is_favorite   ON media_items(is_favorite);
CREATE INDEX IF NOT EXISTS idx_media_is_active     ON media_items(is_active);
CREATE INDEX IF NOT EXISTS idx_media_created_at    ON media_items(created_at);
```

### Table `watch_events`

```sql
CREATE TABLE IF NOT EXISTS watch_events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    media_item_id   INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    event_type      TEXT    NOT NULL CHECK(event_type IN (
                        'view_start','view_end','skip','favorite',
                        'open_from_grid','open_from_feed'
                    )),
    watched_seconds REAL,
    timestamp       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_events_media_id  ON watch_events(media_item_id);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON watch_events(timestamp);
```

---

## 4. Media & Folder Lifecycle Management

### Discovery & Ingestion
1. During filesystem scanning, [backend/app/scanner.py](file:///f:/local-media/backend/app/scanner.py) indexes folder hierarchies and creates/updates `folders` rows.
2. Files are matched by path. If a file is new, an `INSERT` is executed with initial metadata.
3. If an existing item's `mtime` or `size` changed on disk, metadata is re-probed and updated.

### Soft Deletion (`is_active = 0`)
- When a previously scanned file is not found during a full scan, it is marked `is_active = 0` rather than deleted immediately.
- **Benefits**: User favorites, engagement stats, custom titles, and event logs are preserved if a drive is temporarily disconnected or remounted.
- If the file reappears in a subsequent scan, it is set back to `is_active = 1`.

---

## 5. Schema Evolution & Migration Rules

> [!CAUTION]
> LocalFeed databases reside on user machines. Never execute destructive schema changes (`DROP TABLE`, dropping columns) or wipe data upon startup.

When modifying the database:
1. Ensure all `CREATE TABLE` and `CREATE INDEX` statements maintain `IF NOT EXISTS`.
2. For new columns, use non-breaking default values and `ALTER TABLE ... ADD COLUMN` checks during startup if needed.
3. Preserve backward compatibility with existing databases.
