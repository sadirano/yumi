"""Frozen-friendly entry point for the yumi server.

`run.cmd` launches the dev server with `uvicorn app.main:app`, but a PyInstaller
build needs a plain script that boots uvicorn programmatically. We pass the app
object directly and pin the protocol implementations (asyncio loop, h11 HTTP, no
websockets) so PyInstaller's static analysis doesn't have to chase uvicorn's
`auto` runtime loaders — the usual "builds fine, ModuleNotFoundError at startup"
trap. yumi uses no websockets, so `ws="none"` is safe and trims the bundle.
"""
from __future__ import annotations

import uvicorn

from app.main import app
from app.settings import settings


def main() -> None:
    uvicorn.run(
        app,
        host=settings.host,
        port=settings.port,
        loop="asyncio",
        http="h11",
        ws="none",
        log_level="info",
    )


if __name__ == "__main__":
    main()
