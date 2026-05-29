from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest


@pytest.fixture
def tmp_data_dir(monkeypatch):
    with tempfile.TemporaryDirectory() as d:
        monkeypatch.setenv("YUMI_DATA_DIR", d)
        yield Path(d)


@pytest.fixture
def client(tmp_data_dir, monkeypatch):
    # Reload modules so the engine binds to the temp DB
    import importlib
    import sys
    for mod in list(sys.modules):
        if mod.startswith("app."):
            del sys.modules[mod]
    if "app" in sys.modules:
        del sys.modules["app"]

    # Stub yt-dlp so enrichment is deterministic and offline.
    import types
    yt_stub = types.ModuleType("yt_dlp")

    class _YDL:
        def __init__(self, *a, **k): pass
        def __enter__(self): return self
        def __exit__(self, *a): return False
        def extract_info(self, url, download=False):
            return {
                "title": "Stub Title",
                "description": "Stub description",
                "uploader": "Stub Channel",
                "thumbnail": "https://example.com/t.jpg",
                "duration": 123,
                "upload_date": "20260101",
            }

    yt_stub.YoutubeDL = _YDL
    sys.modules["yt_dlp"] = yt_stub

    from fastapi.testclient import TestClient
    from app.main import app
    from app.db import init_db, engine

    init_db()
    with TestClient(app) as c:
        yield c
    engine.dispose()
