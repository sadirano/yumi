"""Scheduled status resets (Space reset rules).

Each Space may carry rules like "daily at 21:00" or "weekly on Monday at
21:00" (think GW2 daily/weekly reset). When a rule's latest scheduled
occurrence passes, every non-archived in-progress/completed item matching the
Space predicate — optionally narrowed by the rule's tags — flips back to
"plan".

Execution is catch-up based rather than a precise alarm: `apply_due_resets`
compares each rule's last *scheduled* occurrence against its `last_run_at`
stamp, so a reset that falls while the app is closed applies on the next
startup, and the minute-sweep in main.py picks it up near-live while running.
All times are local wall-clock (the reset hour is "9 PM here", not UTC).
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from .models import Item, Space, Tag

# Statuses a reset rolls back. Archived is a deliberate shelf — leave it alone.
_RESETTABLE = ("in-progress", "completed")


def local_now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def _last_occurrence(rule: dict, now: datetime) -> datetime | None:
    """The most recent moment this rule was scheduled to fire, or None if the
    rule is malformed (bad time string)."""
    try:
        hh, mm = (int(p) for p in str(rule.get("time", "")).split(":"))
        occ = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
    except ValueError:
        return None
    if rule.get("frequency") == "weekly":
        # weekday: 0=Monday … 6=Sunday, matching datetime.weekday().
        occ -= timedelta(days=(now.weekday() - int(rule.get("weekday", 0))) % 7)
        if occ > now:
            occ -= timedelta(days=7)
    else:
        if occ > now:
            occ -= timedelta(days=1)
    return occ


def _reset_space_items(db: Session, space: Space, rule_tags: list[str]) -> int:
    """Set matching live items back to "plan"; returns how many changed.
    Mirrors the Space membership predicate used by GET /api/items."""
    stmt = select(Item).where(Item.deleted_at.is_(None), Item.status.in_(_RESETTABLE))
    namespaces = json.loads(space.namespaces_json)
    required_tags = json.loads(space.tags_json)
    if namespaces:
        ns_filters = [Tag.name.like(f"{ns}:%") for ns in namespaces]
        stmt = stmt.where(
            Item.id.in_(select(Item.id).join(Item.tags).where(or_(*ns_filters)))
        )
    for tag_name in [*required_tags, *rule_tags]:
        stmt = stmt.where(
            Item.id.in_(select(Item.id).join(Item.tags).where(Tag.name == tag_name))
        )
    items = db.scalars(stmt).unique().all()
    for item in items:
        item.status = "plan"
    return len(items)


def apply_due_resets(db: Session) -> int:
    """Run every due reset rule once; returns the number of items reset.
    Commits only when something changed (items or last_run_at stamps)."""
    now = datetime.now().astimezone()
    total = 0
    dirty = False
    for space in db.scalars(select(Space)).all():
        try:
            rules = json.loads(space.reset_rules_json or "[]")
        except ValueError:
            continue
        changed = False
        for rule in rules:
            occ = _last_occurrence(rule, now)
            if occ is None:
                continue
            last_raw = rule.get("last_run_at")
            if last_raw:
                try:
                    last = datetime.fromisoformat(last_raw)
                except ValueError:
                    last = None
                if last is not None:
                    if last.tzinfo is None:
                        last = last.astimezone()
                    if last >= occ:
                        continue
            total += _reset_space_items(db, space, rule.get("tags") or [])
            rule["last_run_at"] = now.isoformat(timespec="seconds")
            changed = True
        if changed:
            space.reset_rules_json = json.dumps(rules)
            dirty = True
    if dirty:
        db.commit()
    return total
