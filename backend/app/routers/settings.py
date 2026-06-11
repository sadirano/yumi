from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_session
from ..models import AppSetting

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingValue(BaseModel):
    value: Any = None


@router.get("")
def list_settings(db: Session = Depends(get_session)) -> dict[str, Any]:
    return {s.key: json.loads(s.value_json) for s in db.scalars(select(AppSetting))}


@router.put("/{key}")
def put_setting(key: str, payload: SettingValue, db: Session = Depends(get_session)) -> dict[str, Any]:
    s = db.get(AppSetting, key)
    if s is None:
        s = AppSetting(key=key)
        db.add(s)
    s.value_json = json.dumps(payload.value)
    db.commit()
    return {"key": key, "value": payload.value}
