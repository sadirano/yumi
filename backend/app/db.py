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


def init_db() -> None:
    from . import models  # noqa: F401  ensure models are imported

    Base.metadata.create_all(engine)
    with engine.begin() as conn:
        for stmt in FTS_SETUP_SQL:
            conn.execute(text(stmt))


def get_session() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
