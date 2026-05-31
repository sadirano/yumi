from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Space, SpaceFilter
from ..schemas import SavedFilterCreate, SavedFilterOut, SavedFilterPatch

router = APIRouter(tags=["saved-filters"])


def _out(f: SpaceFilter) -> SavedFilterOut:
    return SavedFilterOut(
        id=f.id,
        space_id=f.space_id,
        name=f.name,
        params=json.loads(f.params_json),
        created_at=f.created_at,
    )


@router.get("/api/spaces/{space_id}/filters", response_model=list[SavedFilterOut])
def list_filters(space_id: int, db: Session = Depends(get_session)):
    if not db.get(Space, space_id):
        raise HTTPException(404, "space not found")
    rows = db.scalars(
        select(SpaceFilter)
        .where(SpaceFilter.space_id == space_id)
        .order_by(SpaceFilter.created_at)
    ).all()
    return [_out(f) for f in rows]


@router.post(
    "/api/spaces/{space_id}/filters",
    response_model=SavedFilterOut,
    status_code=status.HTTP_201_CREATED,
)
def create_filter(space_id: int, payload: SavedFilterCreate, db: Session = Depends(get_session)):
    if not db.get(Space, space_id):
        raise HTTPException(404, "space not found")
    name = payload.name.strip()
    if not name:
        raise HTTPException(400, "name required")
    f = SpaceFilter(
        space_id=space_id,
        name=name,
        params_json=json.dumps(payload.params),
    )
    db.add(f)
    db.commit()
    db.refresh(f)
    return _out(f)


@router.patch("/api/saved-filters/{filter_id}", response_model=SavedFilterOut)
def update_filter(filter_id: int, payload: SavedFilterPatch, db: Session = Depends(get_session)):
    f = db.get(SpaceFilter, filter_id)
    if not f:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise HTTPException(400, "name required")
        f.name = name
    if payload.params is not None:
        f.params_json = json.dumps(payload.params)
    db.commit()
    db.refresh(f)
    return _out(f)


@router.delete("/api/saved-filters/{filter_id}", status_code=204)
def delete_filter(filter_id: int, db: Session = Depends(get_session)):
    f = db.get(SpaceFilter, filter_id)
    if not f:
        raise HTTPException(404, "not found")
    db.delete(f)
    db.commit()
