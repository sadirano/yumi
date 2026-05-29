from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Item, ItemTag, Tag
from ..schemas import TagOut

router = APIRouter(prefix="/api/tags", tags=["tags"])


@router.get("", response_model=list[TagOut])
def list_tags(
    db: Session = Depends(get_session),
    prefix: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    stmt = select(Tag, func.count(ItemTag.item_id).label("n")).outerjoin(
        ItemTag, ItemTag.tag_id == Tag.id
    ).group_by(Tag.id).order_by(func.count(ItemTag.item_id).desc(), Tag.name)
    if prefix:
        stmt = stmt.where(Tag.name.like(f"{prefix.lower()}%"))
    stmt = stmt.limit(limit)
    rows = db.execute(stmt).all()
    return [TagOut(id=t.id, name=t.name, count=n) for t, n in rows]


@router.delete("/{name}", status_code=204)
def remove_tag(name: str, db: Session = Depends(get_session)):
    tag = db.scalar(select(Tag).where(Tag.name == name.lower()))
    if not tag:
        raise HTTPException(404, "tag not found")
    db.execute(delete(ItemTag).where(ItemTag.tag_id == tag.id))
    db.delete(tag)
    db.commit()
