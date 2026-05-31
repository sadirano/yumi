from __future__ import annotations

import sqlite3
from datetime import datetime
from pathlib import Path

from .settings import settings

# Rolling point-in-time copies of the SQLite library so a bad edit or a corrupt
# write is recoverable. Snapshots are taken at startup as a catch-up — at most
# one daily and one monthly per period — using SQLite's online backup API so the
# copy is consistent even with WAL writes in flight. Never a raw file copy: that
# can capture a torn page or miss the -wal sidecar.

DAILY_KEEP = 7
MONTHLY_KEEP = 12

_DAILY_PREFIX = "favorites-daily-"
_MONTHLY_PREFIX = "favorites-monthly-"
_SUFFIX = ".sqlite"


def backup_dir() -> Path:
    d = settings.data_dir / "backups"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _snapshot(src: Path, dest: Path) -> None:
    """Consistent online copy of the DB via SQLite's backup API.

    Writes to a temp sibling first and atomically renames, so a crash mid-copy
    never leaves a half-written file under a real snapshot name.
    """
    tmp = dest.with_name(dest.name + ".tmp")
    src_con = sqlite3.connect(src)
    try:
        dst_con = sqlite3.connect(tmp)
        try:
            src_con.backup(dst_con)
        finally:
            dst_con.close()
    finally:
        src_con.close()
    tmp.replace(dest)


def _prune(dirpath: Path, prefix: str, keep: int) -> None:
    # ISO date/month stamps sort lexicographically, so name order == age order.
    snaps = sorted(dirpath.glob(f"{prefix}*{_SUFFIX}"), key=lambda p: p.name)
    for old in snaps[:-keep]:
        try:
            old.unlink()
        except OSError:
            pass


def run_startup_backup() -> list[str]:
    """Create today's daily and this month's monthly snapshot if missing, then
    prune each set to its retention window. Returns the names created.

    Local date is used for the human-facing filename. Best-effort: the caller
    swallows exceptions so a backup failure can never block app startup.
    """
    src = settings.db_path
    if not src.exists():
        return []
    now = datetime.now()
    dirpath = backup_dir()
    created: list[str] = []
    for prefix, stamp, keep in (
        (_DAILY_PREFIX, now.strftime("%Y-%m-%d"), DAILY_KEEP),
        (_MONTHLY_PREFIX, now.strftime("%Y-%m"), MONTHLY_KEEP),
    ):
        dest = dirpath / f"{prefix}{stamp}{_SUFFIX}"
        if not dest.exists():
            _snapshot(src, dest)
            created.append(dest.name)
        _prune(dirpath, prefix, keep)
    return created
