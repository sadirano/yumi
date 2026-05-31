from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Space
from ..schemas import SpaceCreate, SpaceOut, SpacePatch

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


def _out(s: Space) -> SpaceOut:
    return SpaceOut(
        id=s.id,
        name=s.name,
        namespaces=json.loads(s.namespaces_json),
        tags=json.loads(s.tags_json),
        labels=json.loads(s.labels_json) if s.labels_json else None,
        created_at=s.created_at,
    )


@router.get("", response_model=list[SpaceOut])
def list_spaces(db: Session = Depends(get_session)):
    return [_out(s) for s in db.scalars(select(Space).order_by(Space.created_at)).all()]


@router.post("", response_model=SpaceOut, status_code=status.HTTP_201_CREATED)
def create_space(payload: SpaceCreate, db: Session = Depends(get_session)):
    s = Space(
        name=payload.name.strip(),
        namespaces_json=json.dumps(sorted(payload.namespaces)),
        tags_json=json.dumps(sorted(payload.tags)),
        labels_json=json.dumps(payload.labels) if payload.labels else None,
    )
    db.add(s)
    db.commit()
    db.refresh(s)
    return _out(s)


@router.patch("/{space_id}", response_model=SpaceOut)
def update_space(space_id: int, payload: SpacePatch, db: Session = Depends(get_session)):
    s = db.get(Space, space_id)
    if not s:
        raise HTTPException(404, "not found")
    if payload.name is not None:
        s.name = payload.name.strip()
    if payload.namespaces is not None:
        s.namespaces_json = json.dumps(sorted(payload.namespaces))
    if payload.tags is not None:
        s.tags_json = json.dumps(sorted(payload.tags))
    if payload.labels is not None:
        # Empty dict clears back to canonical defaults.
        s.labels_json = json.dumps(payload.labels) if payload.labels else None
    db.commit()
    db.refresh(s)
    return _out(s)


@router.delete("/{space_id}", status_code=204)
def delete_space(space_id: int, db: Session = Depends(get_session)):
    s = db.get(Space, space_id)
    if not s:
        raise HTTPException(404, "not found")
    db.delete(s)
    db.commit()
