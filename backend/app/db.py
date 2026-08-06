"""
SQLite database setup — raw sqlite3 with a thin connection helper.
Schema creation is handled here; no ORM is used to keep queries fast and transparent.
"""
from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path

from app.config import DB_PATH


def _get_connection(db_path: Path = DB_PATH) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    # WAL mode for concurrent reads during background scan
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA cache_size=-32000")  # 32 MB page cache
    return conn


@contextmanager
def get_db():
    """Context manager yielding a sqlite3.Connection (auto-commit on exit)."""
    conn = _get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


CREATE_SCHEMA = """
-- Folders / Tags / Profiles
CREATE TABLE IF NOT EXISTS folders (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    name                TEXT    NOT NULL,
    display_name        TEXT,                        -- user-editable override
    path                TEXT    NOT NULL UNIQUE,
    parent_folder_id    INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    item_count          INTEGER NOT NULL DEFAULT 0,
    cover_thumbnail_path TEXT,
    created_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_folders_parent ON folders(parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_folders_path   ON folders(path);

-- Media items (videos + images)
CREATE TABLE IF NOT EXISTS media_items (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id               INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
    media_type              TEXT    NOT NULL CHECK(media_type IN ('video','image')),
    filename                TEXT    NOT NULL,
    path                    TEXT    NOT NULL UNIQUE,
    title                   TEXT    NOT NULL,
    -- video-only fields
    duration_seconds        REAL,
    codec                   TEXT,
    browser_native          INTEGER NOT NULL DEFAULT 1,   -- 0 = needs transcode
    -- shared metadata
    resolution              TEXT,
    orientation             TEXT    CHECK(orientation IN ('landscape','portrait','square')),
    file_size_bytes         INTEGER,
    thumbnail_path          TEXT,
    -- timestamps
    created_at              TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
    file_modified_at        TEXT,
    captured_at             TEXT,                         -- EXIF DateTimeOriginal
    last_watched_at         TEXT,
    -- engagement
    watch_count             INTEGER NOT NULL DEFAULT 0,
    is_favorite             INTEGER NOT NULL DEFAULT 0,
    duration_watched_seconds REAL   NOT NULL DEFAULT 0,
    -- lifecycle
    is_active               INTEGER NOT NULL DEFAULT 1    -- 0 = file deleted/moved
);

CREATE INDEX IF NOT EXISTS idx_media_folder_id      ON media_items(folder_id);
CREATE INDEX IF NOT EXISTS idx_media_file_modified  ON media_items(file_modified_at);
CREATE INDEX IF NOT EXISTS idx_media_type           ON media_items(media_type);
CREATE INDEX IF NOT EXISTS idx_media_is_favorite    ON media_items(is_favorite);
CREATE INDEX IF NOT EXISTS idx_media_is_active      ON media_items(is_active);
CREATE INDEX IF NOT EXISTS idx_media_created_at     ON media_items(created_at);

-- Watch / view events (write-once log for future recommendation engine)
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
"""


def create_schema(db_path: Path = DB_PATH) -> None:
    """Create all tables and indexes (idempotent — uses IF NOT EXISTS)."""
    conn = _get_connection(db_path)
    try:
        conn.executescript(CREATE_SCHEMA)
        conn.commit()
    finally:
        conn.close()
