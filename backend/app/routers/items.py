from __future__ import annotations

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import delete as sa_delete, func, select
from sqlalchemy.orm import Session

from ..crud import find_live_by_path, find_live_by_url, get_or_create_tags, normalize_tag, set_item_tags
from ..db import get_session
from ..enrich import enrich_url, normalize_url
from ..models import Item, ItemRevision, Space, Tag, utcnow_iso
from ..schemas import ItemCreate, ItemOut, ItemPatch, RevisionOut

_MAX_REVISIONS = 50


def _snapshot(db: Session, item: Item) -> None:
    """Save a revision of item's current state; skip if identical to the last one."""
    tags_json = json.dumps(sorted(t.name for t in item.tags))
    last = db.scalar(
        select(ItemRevision)
        .where(ItemRevision.item_id == item.id)
        .order_by(ItemRevision.created_at.desc())
        .limit(1)
    )
    if last and (
        last.title == item.title
        and last.notes_md == item.notes_md
        and last.tags_json == tags_json
        and last.source == item.source
        and last.status == item.status
        and last.progress == item.progress
        and last.total == item.total
    ):
        return
    db.add(ItemRevision(
        item_id=item.id,
        title=item.title,
        notes_md=item.notes_md,
        tags_json=tags_json,
        source=item.source,
        status=item.status,
        progress=item.progress,
        total=item.total,
    ))
    db.flush()
    count = db.scalar(
        select(func.count()).select_from(ItemRevision).where(ItemRevision.item_id == item.id)
    )
    if count and count > _MAX_REVISIONS:
        oldest = db.scalars(
            select(ItemRevision.id)
            .where(ItemRevision.item_id == item.id)
            .order_by(ItemRevision.created_at.asc())
            .limit(count - _MAX_REVISIONS)
        ).all()
        db.execute(sa_delete(ItemRevision).where(ItemRevision.id.in_(oldest)))

router = APIRouter(prefix="/api/items", tags=["items"])


@router.post("", response_model=ItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(payload: ItemCreate, db: Session = Depends(get_session)):
    if not (payload.url or payload.file_path or payload.note_title or payload.note_body):
        raise HTTPException(400, "Provide one of: url, file_path, note_title/note_body")

    if payload.url:
        url = normalize_url(payload.url)
        existing = find_live_by_url(db, url)
        if existing:
            raise HTTPException(status_code=409, detail={"reason": "duplicate", "existing_id": existing.id})
        enr = await enrich_url(url)
        item = Item(
            kind=enr.kind,
            url=url,
            title=enr.title or url,
            description=enr.description,
            channel=enr.channel,
            thumbnail_url=enr.thumbnail_url,
            duration_sec=enr.duration_sec,
            published_at=enr.published_at,
            notes_md=payload.notes_md,
            status=payload.status,
            source=payload.source,
            needs_enrichment=enr.needs_enrichment,
        )
    elif payload.file_path:
        existing = find_live_by_path(db, payload.file_path)
        if existing:
            raise HTTPException(status_code=409, detail={"reason": "duplicate", "existing_id": existing.id})
        item = Item(
            kind="file",
            file_path=payload.file_path,
            title=payload.note_title or payload.file_path.rsplit("/", 1)[-1].rsplit("\\", 1)[-1],
            notes_md=payload.notes_md,
            status=payload.status,
            source=payload.source,
        )
    else:
        item = Item(
            kind="note",
            title=payload.note_title or "(untitled note)",
            notes_md=payload.notes_md or (payload.note_body or ""),
            status=payload.status,
            source=payload.source,
        )

    db.add(item)
    db.flush()
    if payload.tags:
        item.tags = get_or_create_tags(db, payload.tags)
    db.commit()
    db.refresh(item)
    return item


@router.get("", response_model=list[ItemOut])
def list_items(
    db: Session = Depends(get_session),
    q: Optional[str] = None,
    tags: Optional[str] = Query(None, description="comma-separated"),
    tag_op: str = Query("AND", pattern="^(AND|OR)$"),
    exclude_tags: Optional[str] = Query(None, description="comma-separated"),
    status_in: Optional[str] = Query(None, description="comma-separated"),
    sort: str = Query("recent", pattern="^(recent|random|duration|title)$"),
    limit: int = Query(60, ge=1, le=500),
    offset: int = Query(0, ge=0),
    space_id: Optional[int] = Query(None),
):
    stmt = select(Item).where(Item.deleted_at.is_(None))

    if space_id is not None:
        space = db.get(Space, space_id)
        if space:
            from sqlalchemy import or_
            namespaces = json.loads(space.namespaces_json)
            required_tags = json.loads(space.tags_json)
            if namespaces:
                ns_filters = [Tag.name.like(f"{ns}:%") for ns in namespaces]
                stmt = stmt.where(
                    Item.id.in_(
                        select(Item.id).join(Item.tags).where(or_(*ns_filters))
                    )
                )
            for tag_name in required_tags:
                stmt = stmt.where(
                    Item.id.in_(
                        select(Item.id).join(Item.tags).where(Tag.name == tag_name)
                    )
                )

    if status_in:
        statuses = [s.strip() for s in status_in.split(",") if s.strip()]
        if statuses:
            stmt = stmt.where(Item.status.in_(statuses))

    if q:
        from sqlalchemy import text
        sub = text(
            "SELECT rowid FROM items_fts WHERE items_fts MATCH :q"
        ).bindparams(q=_fts_query(q))
        stmt = stmt.where(Item.id.in_(sub))

    tag_list = [normalize_tag(t) for t in (tags.split(",") if tags else []) if t.strip()]
    excl_list = [normalize_tag(t) for t in (exclude_tags.split(",") if exclude_tags else []) if t.strip()]

    if tag_list:
        if tag_op == "OR":
            stmt = stmt.where(
                Item.id.in_(
                    select(Item.id).join(Item.tags).where(Tag.name.in_(tag_list))
                )
            )
        else:
            for name in tag_list:
                stmt = stmt.where(
                    Item.id.in_(
                        select(Item.id).join(Item.tags).where(Tag.name == name)
                    )
                )

    if excl_list:
        stmt = stmt.where(
            ~Item.id.in_(
                select(Item.id).join(Item.tags).where(Tag.name.in_(excl_list))
            )
        )

    if sort == "recent":
        stmt = stmt.order_by(Item.created_at.desc())
    elif sort == "random":
        stmt = stmt.order_by(func.random())
    elif sort == "duration":
        stmt = stmt.order_by(Item.duration_sec.is_(None), Item.duration_sec.desc())
    else:
        stmt = stmt.order_by(func.lower(Item.title))

    stmt = stmt.limit(limit).offset(offset)
    return db.scalars(stmt).unique().all()


def _fts_query(q: str) -> str:
    # Escape double quotes; wrap each token in quotes for safety; combine with AND
    tokens = [t for t in q.replace('"', '""').split() if t]
    if not tokens:
        return '""'
    return " ".join(f'"{t}"*' for t in tokens)


@router.get("/{item_id}", response_model=ItemOut)
def get_item(item_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item:
        raise HTTPException(404, "not found")
    return item


@router.patch("/{item_id}", response_model=ItemOut)
def patch_item(
    item_id: int,
    payload: ItemPatch,
    snapshot: bool = Query(True, description="set false for lightweight edits (e.g. inline tag tweaks) that shouldn't write revision history"),
    db: Session = Depends(get_session),
):
    item = db.get(Item, item_id)
    if not item or item.deleted_at:
        raise HTTPException(404, "not found")
    if snapshot:
        _snapshot(db, item)
    data = payload.model_dump(exclude_unset=True)
    if "tags" in data:
        set_item_tags(db, item, data.pop("tags") or [])
    if "related_links" in data:
        # Drop blank rows (no url) so half-typed entries don't persist.
        links = [l for l in (data.pop("related_links") or []) if l.get("url", "").strip()]
        item.related_links_json = json.dumps(links)
    for k, v in data.items():
        setattr(item, k, v)
    item.updated_at = utcnow_iso()
    db.commit()
    db.refresh(item)
    return item


@router.get("/{item_id}/revisions", response_model=list[RevisionOut])
def list_revisions(item_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item or item.deleted_at:
        raise HTTPException(404, "not found")
    return db.scalars(
        select(ItemRevision)
        .where(ItemRevision.item_id == item_id)
        .order_by(ItemRevision.created_at.desc())
    ).all()


@router.post("/{item_id}/revisions/{rev_id}/restore", response_model=ItemOut)
def restore_revision(item_id: int, rev_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item or item.deleted_at:
        raise HTTPException(404, "not found")
    rev = db.get(ItemRevision, rev_id)
    if not rev or rev.item_id != item_id:
        raise HTTPException(404, "revision not found")
    _snapshot(db, item)
    item.title = rev.title
    item.notes_md = rev.notes_md
    item.source = rev.source
    item.status = rev.status  # type: ignore[assignment]
    item.progress = rev.progress
    item.total = rev.total
    item.updated_at = utcnow_iso()
    set_item_tags(db, item, json.loads(rev.tags_json))
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204)
def soft_delete(item_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item or item.deleted_at:
        raise HTTPException(404, "not found")
    item.deleted_at = utcnow_iso()
    db.commit()


@router.post("/{item_id}/restore", response_model=ItemOut)
def restore(item_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item or not item.deleted_at:
        raise HTTPException(404, "not in trash")
    if item.url:
        clash = find_live_by_url(db, item.url)
        if clash:
            raise HTTPException(409, {"reason": "duplicate", "existing_id": clash.id})
    if item.file_path:
        clash = find_live_by_path(db, item.file_path)
        if clash:
            raise HTTPException(409, {"reason": "duplicate", "existing_id": clash.id})
    item.deleted_at = None
    item.updated_at = utcnow_iso()
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}/purge", status_code=204)
def purge(item_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item or not item.deleted_at:
        raise HTTPException(404, "not in trash")
    db.delete(item)
    db.commit()


@router.post("/{item_id}/refresh", response_model=ItemOut)
async def refresh_enrichment(item_id: int, db: Session = Depends(get_session)):
    item = db.get(Item, item_id)
    if not item or item.deleted_at:
        raise HTTPException(404, "not found")
    if not item.url:
        raise HTTPException(400, "item has no URL to refresh")
    enr = await enrich_url(item.url)
    item.title = enr.title or item.title
    item.description = enr.description or item.description
    item.channel = enr.channel or item.channel
    item.thumbnail_url = enr.thumbnail_url or item.thumbnail_url
    item.duration_sec = enr.duration_sec or item.duration_sec
    item.published_at = enr.published_at or item.published_at
    item.needs_enrichment = enr.needs_enrichment
    item.updated_at = utcnow_iso()
    db.commit()
    db.refresh(item)
    return item
