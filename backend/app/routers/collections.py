from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Collection, CollectionItem, Item, utcnow_iso
from ..schemas import (
    CollectionBase,
    CollectionDetail,
    CollectionItemAdd,
    CollectionItemMove,
    CollectionOut,
    ItemOut,
)

router = APIRouter(prefix="/api/collections", tags=["collections"])


def _next_position(db: Session, collection_id: int, after_id: Optional[int]) -> float:
    rows = db.execute(
        select(CollectionItem.item_id, CollectionItem.position)
        .where(CollectionItem.collection_id == collection_id)
        .order_by(CollectionItem.position)
    ).all()
    positions = [(r[0], r[1]) for r in rows]

    if not positions:
        return 1.0

    if after_id is None:
        # Default: append at end.
        return positions[-1][1] + 1.0

    if after_id == 0:
        # Explicit "move to top" sentinel.
        return positions[0][1] - 1.0

    for i, (iid, pos) in enumerate(positions):
        if iid == after_id:
            if i + 1 < len(positions):
                return (pos + positions[i + 1][1]) / 2
            return pos + 1.0

    return positions[-1][1] + 1.0


@router.get("", response_model=list[CollectionOut])
def list_collections(db: Session = Depends(get_session)):
    stmt = (
        select(Collection, func.count(CollectionItem.item_id).label("n"))
        .outerjoin(CollectionItem, CollectionItem.collection_id == Collection.id)
        .group_by(Collection.id)
        .order_by(Collection.name)
    )
    out: list[CollectionOut] = []
    for c, n in db.execute(stmt).all():
        cm = CollectionOut.model_validate(c)
        cm.item_count = int(n or 0)
        out.append(cm)
    return out


@router.post("", response_model=CollectionOut, status_code=201)
def create_collection(payload: CollectionBase, db: Session = Depends(get_session)):
    c = Collection(name=payload.name.strip(), notes_md=payload.notes_md)
    db.add(c)
    db.commit()
    db.refresh(c)
    return c


@router.get("/{cid}", response_model=CollectionDetail)
def get_collection(cid: int, db: Session = Depends(get_session)):
    c = db.get(Collection, cid)
    if not c:
        raise HTTPException(404, "not found")
    items = db.scalars(
        select(Item)
        .join(CollectionItem, CollectionItem.item_id == Item.id)
        .where(CollectionItem.collection_id == cid, Item.deleted_at.is_(None))
        .order_by(CollectionItem.position)
    ).unique().all()
    detail = CollectionDetail.model_validate(c)
    detail.items = [ItemOut.model_validate(i) for i in items]
    detail.item_count = len(detail.items)
    return detail


@router.patch("/{cid}", response_model=CollectionOut)
def patch_collection(cid: int, payload: CollectionBase, db: Session = Depends(get_session)):
    c = db.get(Collection, cid)
    if not c:
        raise HTTPException(404, "not found")
    c.name = payload.name.strip()
    c.notes_md = payload.notes_md
    c.updated_at = utcnow_iso()
    db.commit()
    db.refresh(c)
    return c


@router.delete("/{cid}", status_code=204)
def delete_collection(cid: int, db: Session = Depends(get_session)):
    c = db.get(Collection, cid)
    if not c:
        raise HTTPException(404, "not found")
    db.delete(c)
    db.commit()


@router.post("/{cid}/items", status_code=204)
def add_to_collection(cid: int, payload: CollectionItemAdd, db: Session = Depends(get_session)):
    c = db.get(Collection, cid)
    item = db.get(Item, payload.item_id)
    if not c or not item or item.deleted_at:
        raise HTTPException(404, "not found")
    existing = db.get(CollectionItem, {"collection_id": cid, "item_id": payload.item_id})
    if existing:
        return
    pos = _next_position(db, cid, payload.after_id)
    db.add(CollectionItem(collection_id=cid, item_id=payload.item_id, position=pos))
    c.updated_at = utcnow_iso()
    db.commit()


@router.delete("/{cid}/items/{item_id}", status_code=204)
def remove_from_collection(cid: int, item_id: int, db: Session = Depends(get_session)):
    ci = db.get(CollectionItem, {"collection_id": cid, "item_id": item_id})
    if not ci:
        raise HTTPException(404, "not found")
    db.delete(ci)
    db.commit()


@router.patch("/{cid}/items/{item_id}", status_code=204)
def move_in_collection(cid: int, item_id: int, payload: CollectionItemMove,
                       db: Session = Depends(get_session)):
    ci = db.get(CollectionItem, {"collection_id": cid, "item_id": item_id})
    if not ci:
        raise HTTPException(404, "not found")
    ci.position = _next_position(db, cid, payload.after_id)
    db.commit()
