from __future__ import annotations

from typing import Iterable

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .models import Item, Tag, utcnow_iso


def normalize_tag(name: str) -> str:
    return name.strip().lower().replace(" ", "-")


def get_or_create_tags(db: Session, names: Iterable[str]) -> list[Tag]:
    cleaned = sorted({normalize_tag(n) for n in names if n and n.strip()})
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


def find_live_by_url(db: Session, url: str) -> Item | None:
    return db.scalar(
        select(Item).where(Item.url == url, Item.deleted_at.is_(None))
    )


def find_live_by_path(db: Session, file_path: str) -> Item | None:
    return db.scalar(
        select(Item).where(Item.file_path == file_path, Item.deleted_at.is_(None))
    )
