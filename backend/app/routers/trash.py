from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Item
from ..schemas import ItemOut

router = APIRouter(prefix="/api/trash", tags=["trash"])


@router.get("", response_model=list[ItemOut])
def list_trash(db: Session = Depends(get_session)):
    return db.scalars(
        select(Item).where(Item.deleted_at.is_not(None)).order_by(Item.deleted_at.desc())
    ).unique().all()
