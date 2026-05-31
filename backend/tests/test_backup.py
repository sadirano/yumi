from __future__ import annotations

import sqlite3


def test_startup_backup_creates_and_is_idempotent(client):
    # Backups run before migrations at boot, so a fresh DB (created during this
    # client's startup) has nothing to snapshot yet. Add a row, then back up.
    from app import backup
    from app.settings import settings

    r = client.post("/api/items", json={"note_title": "Keep me", "tags": ["t"]})
    assert r.status_code == 201, r.text

    # The app lifespan may have already snapshotted the empty DB at startup;
    # clear those so we deterministically snapshot the DB *with* the new row.
    for stale in backup.backup_dir().glob("favorites-*.sqlite"):
        stale.unlink()

    made = backup.run_startup_backup()
    assert any(n.startswith("favorites-daily-") for n in made)
    assert any(n.startswith("favorites-monthly-") for n in made)

    # Each snapshot is a valid SQLite DB and the row survived into the copy.
    for name in made:
        path = settings.data_dir / "backups" / name
        con = sqlite3.connect(path)
        try:
            count = con.execute("SELECT COUNT(*) FROM items").fetchone()[0]
        finally:
            con.close()
        assert count == 1

    # Same period -> no new snapshots on a second run.
    assert backup.run_startup_backup() == []


def test_backup_missing_db_is_noop(client, monkeypatch):
    from app import backup
    from app.settings import settings

    monkeypatch.setattr(type(settings), "db_path", property(
        lambda self: self.data_dir / "does-not-exist.sqlite"
    ))
    assert backup.run_startup_backup() == []


def test_daily_pruning_keeps_window(client):
    from app import backup

    dirpath = backup.backup_dir()
    # Seed more dailies than the window; dates sort below today's real snapshot.
    for day in range(1, 21):
        (dirpath / f"favorites-daily-2000-01-{day:02d}.sqlite").write_bytes(b"x")

    backup.run_startup_backup()  # creates today's daily, then prunes

    dailies = sorted(p.name for p in dirpath.glob("favorites-daily-*.sqlite"))
    assert len(dailies) == backup.DAILY_KEEP
    # The most recent (today's real snapshot) must survive the prune.
    assert dailies[-1] > "favorites-daily-2000-01-20.sqlite"
