from __future__ import annotations

import json
from datetime import datetime, timedelta


def _local_iso(dt: datetime) -> str:
    return dt.astimezone().isoformat(timespec="seconds")


def _make_space_with_rule(client, rule_overrides=None, space_overrides=None):
    rule = {
        "id": "r1",
        "frequency": "daily",
        "time": "21:00",
        "weekday": 0,
        "tags": [],
    }
    rule.update(rule_overrides or {})
    body = {
        "name": "GW2",
        "namespaces": ["game"],
        "tags": [],
        "reset_rules": [rule],
    }
    body.update(space_overrides or {})
    r = client.post("/api/spaces", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def _backdate_rule(space_id: int, days: float = 2.0) -> None:
    """Rewind the rule's last_run_at so its latest occurrence is now due."""
    from app.db import SessionLocal
    from app.models import Space

    with SessionLocal() as db:
        s = db.get(Space, space_id)
        rules = json.loads(s.reset_rules_json)
        for rule in rules:
            rule["last_run_at"] = _local_iso(datetime.now() - timedelta(days=days))
        s.reset_rules_json = json.dumps(rules)
        db.commit()


def _add_note(client, title: str, tags: list[str], status: str = "completed") -> int:
    r = client.post("/api/items", json={"note_title": title, "tags": tags, "status": status})
    assert r.status_code in (200, 201), r.text
    return r.json()["id"]


def test_new_rule_is_stamped_and_does_not_fire_immediately(client):
    space = _make_space_with_rule(client)
    assert space["reset_rules"][0]["last_run_at"]  # server-stamped at creation

    item_id = _add_note(client, "daily fractal", ["game:gw2"])

    from app.db import SessionLocal
    from app.resets import apply_due_resets

    with SessionLocal() as db:
        assert apply_due_resets(db) == 0
    assert client.get(f"/api/items/{item_id}").json()["status"] == "completed"


def test_due_rule_resets_space_items_once(client):
    space = _make_space_with_rule(client)
    done = _add_note(client, "daily fractal", ["game:gw2"], status="completed")
    doing = _add_note(client, "map completion", ["game:gw2"], status="in-progress")
    archived = _add_note(client, "old event", ["game:gw2"], status="archived")
    other_space = _add_note(client, "unrelated", ["music:loop"], status="completed")

    _backdate_rule(space["id"])

    from app.db import SessionLocal
    from app.resets import apply_due_resets

    with SessionLocal() as db:
        assert apply_due_resets(db) == 2

    assert client.get(f"/api/items/{done}").json()["status"] == "plan"
    assert client.get(f"/api/items/{doing}").json()["status"] == "plan"
    # Archived and out-of-space items are untouched.
    assert client.get(f"/api/items/{archived}").json()["status"] == "archived"
    assert client.get(f"/api/items/{other_space}").json()["status"] == "completed"

    # The stamp advanced, so a second sweep is a no-op.
    with SessionLocal() as db:
        assert apply_due_resets(db) == 0


def test_rule_tags_narrow_the_scope(client):
    space = _make_space_with_rule(client, rule_overrides={"tags": ["reset:daily"]})
    daily = _add_note(client, "daily fractal", ["game:gw2", "reset:daily"])
    weekly = _add_note(client, "raid clear", ["game:gw2"])

    _backdate_rule(space["id"])

    from app.db import SessionLocal
    from app.resets import apply_due_resets

    with SessionLocal() as db:
        assert apply_due_resets(db) == 1

    assert client.get(f"/api/items/{daily}").json()["status"] == "plan"
    assert client.get(f"/api/items/{weekly}").json()["status"] == "completed"


def test_patch_preserves_existing_stamp_and_stamps_new_rules(client):
    space = _make_space_with_rule(client)
    original_stamp = space["reset_rules"][0]["last_run_at"]

    rules = space["reset_rules"] + [
        {"id": "r2", "frequency": "weekly", "time": "21:00", "weekday": 0, "tags": [],
         # A client trying to rewind the stamp must be ignored.
         "last_run_at": "2000-01-01T00:00:00+00:00"},
    ]
    r = client.patch(f"/api/spaces/{space['id']}", json={"reset_rules": rules})
    assert r.status_code == 200, r.text
    out = {rule["id"]: rule for rule in r.json()["reset_rules"]}
    assert out["r1"]["last_run_at"] == original_stamp
    assert out["r2"]["last_run_at"] != "2000-01-01T00:00:00+00:00"


def test_weekly_occurrence_math():
    from app.resets import _last_occurrence

    # Wednesday 2026-06-10 12:00 local; weekly Monday 21:00 → Monday 2026-06-08.
    now = datetime(2026, 6, 10, 12, 0).astimezone()
    occ = _last_occurrence({"frequency": "weekly", "time": "21:00", "weekday": 0}, now)
    assert (occ.year, occ.month, occ.day, occ.hour) == (2026, 6, 8, 21)

    # Monday 20:00, weekly Monday 21:00 → previous Monday.
    now = datetime(2026, 6, 8, 20, 0).astimezone()
    occ = _last_occurrence({"frequency": "weekly", "time": "21:00", "weekday": 0}, now)
    assert (occ.month, occ.day) == (6, 1)

    # Daily at 21:00, queried at 20:00 → yesterday 21:00.
    now = datetime(2026, 6, 10, 20, 0).astimezone()
    occ = _last_occurrence({"frequency": "daily", "time": "21:00"}, now)
    assert (occ.day, occ.hour) == (9, 21)

    # Malformed time → rule skipped.
    assert _last_occurrence({"frequency": "daily", "time": "nope"}, now) is None
