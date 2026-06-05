from __future__ import annotations

import time
from typing import Iterable

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import Item, Tag, utcnow_iso
from .settings import settings


def normalize_tag(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def get_or_create_tags(db: Session, names: Iterable[str]) -> list[Tag]:
    cleaned = sorted({normalize_tag(n) for n in names if n and n.strip() and ":" in n})
    if not cleaned:
        return []
    existing = {t.name: t for t in db.scalars(select(Tag).where(Tag.name.in_(cleaned))).all()}
    out: list[Tag] = []
    for n in cleaned:
        tag = existing.get(n)
        if tag is None:
            tag = Tag(name=n)
            db.add(tag)
            db.flush()
        out.append(tag)
    return out


def set_item_tags(db: Session, item: Item, names: list[str]) -> None:
    item.tags = get_or_create_tags(db, names)
    item.updated_at = utcnow_iso()


def sweep_orphan_tags(db: Session) -> int:
    """Delete tags no live item references. Returns how many were removed.

    A zero-count tag can only arise after an item is retagged or hard-deleted;
    re-tagging recreates it via get_or_create_tags, so this is safe to run
    unconditionally (e.g. on startup) without an undo path.
    """
    result = db.execute(
        text(
            "DELETE FROM tags WHERE NOT EXISTS "
            "(SELECT 1 FROM item_tags WHERE item_tags.tag_id = tags.id)"
        )
    )
    db.commit()
    return result.rowcount or 0


def sweep_orphan_uploads(db: Session) -> tuple[int, int]:
    """Move unreferenced upload files to .trash; purge .trash files older than 30 days.

    A file is orphaned when neither thumbnail_url nor notes_md of its owning
    live item references its path. Soft-deleted items are skipped — their files
    survive until the item is purged (which calls shutil.rmtree directly).

    Returns (moved_to_trash, permanently_deleted) counts.
    """
    uploads_dir = settings.uploads_dir
    trash_dir = uploads_dir / ".trash"
    trash_dir.mkdir(exist_ok=True)

    moved = purged = 0
    cutoff = time.time() - 30 * 86400

    for f in trash_dir.iterdir():
        if f.is_file() and f.stat().st_mtime < cutoff:
            f.unlink()
            purged += 1

    for item_dir in uploads_dir.iterdir():
        if not item_dir.is_dir() or item_dir.name.startswith("."):
            continue
        try:
            item_id = int(item_dir.name)
        except ValueError:
            continue

        item = db.get(Item, item_id)
        if not item or item.deleted_at:
            continue

        for f in item_dir.iterdir():
            if not f.is_file():
                continue
            ref = f"/uploads/{item_id}/{f.name}"
            if (item.thumbnail_url and ref in item.thumbnail_url) or \
               (item.notes_md and ref in item.notes_md):
                continue
            dest = trash_dir / f"{item_id}_{f.name}"
            f.rename(dest)
            moved += 1

    return moved, purged


def find_live_by_url(db: Session, url: str) -> Item | None:
    return db.scalar(
        select(Item).where(Item.url == url, Item.deleted_at.is_(None))
    )


def find_live_by_path(db: Session, file_path: str) -> Item | None:
    return db.scalar(
        select(Item).where(Item.file_path == file_path, Item.deleted_at.is_(None))
    )
