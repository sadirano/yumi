from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .backup import run_startup_backup
from .crud import sweep_orphan_tags, sweep_orphan_uploads
from .db import SessionLocal, init_db
from .resets import apply_due_resets
from .routers import items, saved_filters, settings as settings_router, spaces, tags, trash, ai
from .settings import settings

# In a PyInstaller build the static SPA is bundled via datas=[("app/static",
# "app/static")], which lands under sys._MEIPASS. In dev it sits beside this
# module. The spec's data tuple and this path must stay in sync.
if getattr(sys, "frozen", False):
    STATIC_DIR = Path(sys._MEIPASS) / "app" / "static"  # type: ignore[attr-defined]
else:
    STATIC_DIR = Path(__file__).resolve().parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Snapshot the last-good DB *before* migrations run, so a bad migration is
    # recoverable from the same day's backup (init_db applies DROP COLUMN and a
    # status backfill). A pre-migration restore is self-healing: the next boot
    # re-applies migrations to it.
    try:
        made = run_startup_backup()
        if made:
            print(f"[startup] db backup: created {', '.join(made)}")
    except Exception as exc:  # a backup failure must never block startup
        print(f"[startup] db backup skipped: {exc}")
    init_db()
    with SessionLocal() as db:
        removed = sweep_orphan_tags(db)
    if removed:
        print(f"[startup] swept {removed} unused tag(s)")
    with SessionLocal() as db:
        moved, purged = sweep_orphan_uploads(db)
    if moved or purged:
        print(f"[startup] uploads: {moved} orphan(s) moved to trash, {purged} purged after 30 days")
    # Catch up on Space reset rules that fired while the app was closed, then
    # keep a minute-sweep running so a "9 PM reset" lands at 9 PM, not next boot.
    with SessionLocal() as db:
        reset_count = apply_due_resets(db)
    if reset_count:
        print(f"[startup] reset {reset_count} item(s) to plan per space schedules")

    async def _reset_sweep():
        while True:
            await asyncio.sleep(60)
            try:
                with SessionLocal() as db:
                    n = await asyncio.to_thread(apply_due_resets, db)
                if n:
                    print(f"[resets] reset {n} item(s) to plan per space schedules")
            except Exception as exc:  # the sweep must never die
                print(f"[resets] sweep failed: {exc}")

    # Tags with zero live items (left behind by retagging/purges) are swept at
    # startup above; this keeps a long-running instance tidy without a restart.
    async def _orphan_tag_sweep():
        while True:
            await asyncio.sleep(3600)
            try:
                with SessionLocal() as db:
                    n = await asyncio.to_thread(sweep_orphan_tags, db)
                if n:
                    print(f"[tags] swept {n} unused tag(s)")
            except Exception as exc:
                print(f"[tags] sweep failed: {exc}")

    sweep_tasks = [
        asyncio.create_task(_reset_sweep()),
        asyncio.create_task(_orphan_tag_sweep()),
    ]
    yield
    for task in sweep_tasks:
        task.cancel()


app = FastAPI(title="yumi", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(items.router)
app.include_router(tags.router)
app.include_router(spaces.router)
app.include_router(saved_filters.router)
app.include_router(settings_router.router)
app.include_router(trash.router)
app.include_router(ai.router)


@app.get("/api/health")
def health():
    return {"ok": True, "db": str(settings.db_path)}


# Mount user uploads — must come before the SPA catch-all
settings.uploads_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.uploads_dir), name="uploads")

# Mount built frontend if present
if STATIC_DIR.exists() and (STATIC_DIR / "index.html").exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")

    @app.get("/")
    def root_index():
        return FileResponse(STATIC_DIR / "index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # Anything not matched by API or assets falls back to the SPA shell.
        if full_path.startswith("api/"):
            from fastapi import HTTPException
            raise HTTPException(404, "not found")
        # Resolve and confirm the target stays inside STATIC_DIR before serving,
        # so crafted paths like "../../secret" can't escape the static root.
        target = (STATIC_DIR / full_path).resolve()
        if target.is_relative_to(STATIC_DIR) and target.is_file():
            return FileResponse(target)
        return FileResponse(STATIC_DIR / "index.html")
