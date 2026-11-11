import os
import re
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
    map_url TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS people (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS group_members (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, person_id)
);

CREATE TABLE IF NOT EXISTS gathering_people (
    gathering_id INTEGER NOT NULL REFERENCES gatherings(id) ON DELETE CASCADE,
    person_id INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
    PRIMARY KEY (gathering_id, person_id)
);

CREATE INDEX IF NOT EXISTS idx_gatherings_start ON gatherings(start);
CREATE INDEX IF NOT EXISTS idx_beer_log_g ON beer_log(gathering_id);
"""

SEED_BEERS = [("Tiger", 5.0, 330), ("Saigon", 4.9, 330), ("Heineken", 5.0, 330), ("Craft IPA", 6.5, 330)]
# Added later; inserted once into existing databases too (a beer removed afterwards stays removed).
SEED_BEERS_VN = [
    ("Tiger Crystal tall", 4.6, 330), ("Tiger Crystal short", 4.6, 330),
    ("Tiger Brown tall", 5.0, 330), ("Tiger Brown short", 5.0, 330),
    ("Budweiser tall", 5.0, 330), ("Budweiser short", 5.0, 330),
]


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
        _migrate(c)


def _columns(c: sqlite3.Connection, table: str) -> set[str]:
    return {r["name"] for r in c.execute(f"PRAGMA table_info({table})")}


def split_names(text: str) -> list[str]:
    """'An, Binh & Chi and Dung' -> ['An', 'Binh', 'Chi', 'Dung'] (case-insensitive de-dup, order kept)."""
    out, seen = [], set()
    for part in re.split(r",|;|/|\+|&|\band\b|\n", text or "", flags=re.IGNORECASE):
        name = " ".join(part.split())[:60]
        if name and name.lower() not in seen:
            seen.add(name.lower())
            out.append(name)
    return out


def _migrate(c: sqlite3.Connection) -> None:
    """Idempotent upgrades for databases created by older versions."""
    if "map_url" not in _columns(c, "gatherings"):
        c.execute("ALTER TABLE gatherings ADD COLUMN map_url TEXT NOT NULL DEFAULT ''")
    if get_setting(c, "migrated_people") is None:
        # The old free-text "With" field becomes individual people.
        for r in c.execute("SELECT id, attendees FROM gatherings WHERE attendees != ''").fetchall():
            set_people(c, "gathering_people", "gathering_id", r["id"], split_names(r["attendees"]))
        set_setting(c, "migrated_people", "1")
    if get_setting(c, "seeded_beers_vn") is None:
        c.executemany("INSERT OR IGNORE INTO beer_types(name, abv, size_ml) VALUES (?,?,?)", SEED_BEERS_VN)
        set_setting(c, "seeded_beers_vn", "1")


def person_ids(c: sqlite3.Connection, names: list[str]) -> list[int]:
    """Ids for these names, creating people that don't exist yet (names match case-insensitively)."""
    ids = []
    for n in names:
        c.execute("INSERT OR IGNORE INTO people(name) VALUES (?)", (n,))
        ids.append(c.execute("SELECT id FROM people WHERE name=?", (n,)).fetchone()["id"])
    return ids


def set_people(c: sqlite3.Connection, table: str, key: str, owner: int, names: list[str]) -> None:
    """Replace the people linked to one group or gathering."""
    assert (table, key) in (("group_members", "group_id"), ("gathering_people", "gathering_id"))
    c.execute(f"DELETE FROM {table} WHERE {key}=?", (owner,))
    c.executemany(f"INSERT OR IGNORE INTO {table}({key}, person_id) VALUES (?,?)", [(owner, p) for p in person_ids(c, names)])


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
