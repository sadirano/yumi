from __future__ import annotations

import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from .crud import sweep_orphan_tags
from .db import SessionLocal, init_db
from .routers import items, saved_filters, spaces, tags, trash
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
    init_db()
    with SessionLocal() as db:
        removed = sweep_orphan_tags(db)
    if removed:
        print(f"[startup] swept {removed} unused tag(s)")
    yield


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
app.include_router(trash.router)


@app.get("/api/health")
def health():
    return {"ok": True, "db": str(settings.db_path)}


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
