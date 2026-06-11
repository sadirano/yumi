from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .settings import settings


class Base(DeclarativeBase):
    pass


engine: Engine = create_engine(
    settings.db_url,
    connect_args={"check_same_thread": False},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _):
    cur = dbapi_conn.cursor()
    cur.execute("PRAGMA foreign_keys=ON")
    cur.execute("PRAGMA journal_mode=WAL")
    cur.execute("PRAGMA synchronous=NORMAL")
    cur.close()


FTS_SETUP_SQL = [
    """
    CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
        title, description, notes_md, channel,
        content='items', content_rowid='id', tokenize='porter unicode61'
    )
    """,
    """
    CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
        INSERT INTO items_fts(rowid, title, description, notes_md, channel)
        VALUES (new.id, new.title, new.description, new.notes_md, new.channel);
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, description, notes_md, channel)
        VALUES('delete', old.id, old.title, old.description, old.notes_md, old.channel);
    END
    """,
    """
    CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
        INSERT INTO items_fts(items_fts, rowid, title, description, notes_md, channel)
        VALUES('delete', old.id, old.title, old.description, old.notes_md, old.channel);
        INSERT INTO items_fts(rowid, title, description, notes_md, channel)
        VALUES (new.id, new.title, new.description, new.notes_md, new.channel);
    END
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ux_items_url_live
        ON items(url) WHERE url IS NOT NULL AND deleted_at IS NULL
    """,
    """
    CREATE UNIQUE INDEX IF NOT EXISTS ux_items_file_live
        ON items(file_path) WHERE file_path IS NOT NULL AND deleted_at IS NULL
    """,
]


# Columns added to existing tables after their initial release. create_all() only
# creates missing tables, never alters existing ones, so a fresh install gets these
# from the model while an upgraded DB needs the ADD COLUMN. SQLite ADD COLUMN is
# cheap and each is guarded by a PRAGMA check, so this is safe to run every startup.
_COLUMN_MIGRATIONS = [
    ("items", "progress", "INTEGER NOT NULL DEFAULT 0"),
    ("items", "total", "INTEGER"),
    ("item_revisions", "progress", "INTEGER NOT NULL DEFAULT 0"),
    ("item_revisions", "total", "INTEGER"),
    ("items", "access_count", "INTEGER NOT NULL DEFAULT 0"),
    ("items", "last_accessed_at", "TEXT"),
    ("spaces", "labels_json", "TEXT"),
    ("spaces", "note_template_md", "TEXT NOT NULL DEFAULT ''"),
    ("spaces", "templates_json", "TEXT NOT NULL DEFAULT '[]'"),
    ("spaces", "reset_rules_json", "TEXT NOT NULL DEFAULT '[]'"),
]

# Columns retired from the model and dropped from upgraded DBs. SQLite 3.35+
# supports ALTER TABLE DROP COLUMN; each is guarded by a PRAGMA check so this is
# idempotent and a no-op once the column is gone (or on a fresh install).
_DROP_COLUMNS = [
    ("items", "source"),
    ("item_revisions", "source"),
    ("items", "anilist_id"),
    ("items", "related_links_json"),
]

# One-time rename of the watch-specific status names to generic ones. A clean
# 1:1 map, so this is idempotent: after the first run no rows carry the old
# values, and new data only ever uses the new ones, so re-running is a no-op.
_STATUS_RENAME = {"to-watch": "plan", "watching": "in-progress", "watched": "completed"}


def _migrate_statuses(conn) -> None:
    for old, new in _STATUS_RENAME.items():
        conn.execute(
            text("UPDATE items SET status = :new WHERE status = :old"),
            {"new": new, "old": old},
        )
        conn.execute(
            text("UPDATE item_revisions SET status = :new WHERE status = :old"),
            {"new": new, "old": old},
        )
    # Saved filters store status_in as a comma-joined string inside params_json;
    # rewrite each so applying an old filter doesn't silently match nothing.
    import json

    for fid, pj in conn.execute(text("SELECT id, params_json FROM space_filters")).all():
        try:
            params = json.loads(pj or "{}")
        except (ValueError, TypeError):
            continue
        si = params.get("status_in")
        if not si:
            continue
        mapped = ",".join(_STATUS_RENAME.get(s, s) for s in si.split(","))
        if mapped != si:
            params["status_in"] = mapped
            conn.execute(
                text("UPDATE space_filters SET params_json = :p WHERE id = :id"),
                {"p": json.dumps(params), "id": fid},
            )


def init_db() -> None:
    from . import models  # noqa: F401  ensure models are imported

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for table, col, ddl in _COLUMN_MIGRATIONS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if col not in existing:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
        for table, col in _DROP_COLUMNS:
            existing = {row[1] for row in conn.execute(text(f"PRAGMA table_info({table})"))}
            if col in existing:
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN {col}"))
        _migrate_statuses(conn)
        for stmt in FTS_SETUP_SQL:
            conn.execute(text(stmt))


def get_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
