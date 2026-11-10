import os
import secrets
import sqlite3
from contextlib import contextmanager

DB_PATH = os.environ.get("DB_PATH", "data/evenings.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#f59e0b',
    target_days INTEGER
);

CREATE TABLE IF NOT EXISTS beer_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    abv REAL,
    size_ml INTEGER,
    active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS gatherings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    start TEXT NOT NULL,
    end TEXT,
    location TEXT NOT NULL DEFAULT '',
    attendees TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    ride TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    wife_comment TEXT NOT NULL DEFAULT '',
    conditions TEXT NOT NULL DEFAULT '',
    drink_limit INTEGER,
    responded_at TEXT,
    started_at TEXT,
    ended_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS beer_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    gathering_id INTEGER NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE,
    beer_type_id INTEGER REFERENCES beer_types(id) ON DELETE SET NULL,
    qty INTEGER NOT NULL DEFAULT 1,
    ts TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS push_subs (
    endpoint TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS login_failures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL,
    ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_gatherings_start ON gatherings(start);
CREATE INDEX IF NOT EXISTS idx_beer_log_g ON beer_log(gathering_id);
"""

SEED_BEERS = [("Tiger", 5.0, 330), ("Saigon", 4.9, 330), ("Heineken", 5.0, 330), ("Craft IPA", 6.5, 330)]


def connect() -> sqlite3.Connection:
    d = os.path.dirname(DB_PATH)
    if d:
        os.makedirs(d, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def session():
    conn = connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init() -> None:
    with session() as c:
        c.execute("PRAGMA journal_mode=WAL")
        c.executescript(SCHEMA)
        if c.execute("SELECT COUNT(*) FROM beer_types").fetchone()[0] == 0:
            c.executemany("INSERT INTO beer_types(name, abv, size_ml) VALUES (?,?,?)", SEED_BEERS)


def get_setting(c: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(c: sqlite3.Connection, key: str, value: str) -> None:
    c.execute("INSERT INTO settings(key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def ensure_secret(c: sqlite3.Connection, key: str) -> str:
    """Return a persisted random secret, generating it on first use."""
    val = get_setting(c, key)
    if val is None:
        val = secrets.token_urlsafe(32)
        set_setting(c, key, val)
    return val
