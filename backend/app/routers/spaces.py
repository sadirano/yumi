from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import Space
from ..resets import local_now_iso
from ..schemas import ResetRule, SpaceCreate, SpaceOut, SpacePatch

router = APIRouter(prefix="/api/spaces", tags=["spaces"])


def _out(s: Space) -> SpaceOut:
    return SpaceOut(
        id=s.id,
        name=s.name,
        namespaces=json.loads(s.namespaces_json),
        tags=json.loads(s.tags_json),
        labels=json.loads(s.labels_json) if s.labels_json else None,
        note_template_md=s.note_template_md,
        templates=json.loads(s.templates_json) if s.templates_json else [],
        reset_rules=json.loads(s.reset_rules_json) if s.reset_rules_json else [],
        created_at=s.created_at,
    )


def _reset_rules_json(rules: list[ResetRule], previous_json: str | None) -> str:
    """Serialize incoming rules, keeping last_run_at server-authoritative:
    a rule keeps its stored stamp, and a brand-new rule starts "as of now" so
    it first fires at its next occurrence instead of replaying today's."""
    try:
        prev_stamps = {
            r.get("id"): r.get("last_run_at")
            for r in json.loads(previous_json or "[]")
        }
    except ValueError:
        prev_stamps = {}
    out = []
    for r in rules:
        d = r.model_dump()
        d["last_run_at"] = prev_stamps.get(r.id) or local_now_iso()
        out.append(d)
    return json.dumps(out)


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
        note_template_md=payload.note_template_md,
        templates_json=json.dumps([t.model_dump() for t in payload.templates]),
        reset_rules_json=_reset_rules_json(payload.reset_rules, None),
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
    if payload.note_template_md is not None:
        s.note_template_md = payload.note_template_md
    if payload.templates is not None:
        s.templates_json = json.dumps([t.model_dump() for t in payload.templates])
    if payload.reset_rules is not None:
        s.reset_rules_json = _reset_rules_json(payload.reset_rules, s.reset_rules_json)
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
