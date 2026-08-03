from __future__ import annotations

import pytest

from app import enrich


class _FakeResp:
    def __init__(self, status_code: int, payload: dict | None = None):
        self.status_code = status_code
        self._payload = payload or {}

    def json(self):
        return self._payload


class _FakeClient:
    """Stands in for httpx.AsyncClient so the oEmbed tests stay offline."""

    def __init__(self, resp: _FakeResp):
        self._resp = resp

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None):
        return self._resp


@pytest.fixture
def no_ytdlp(monkeypatch):
    """Simulate yt-dlp being refused (the bot challenge seen from datacenter IPs)."""
    monkeypatch.setattr(enrich, "_ytdlp_metadata", lambda url: None)


def _stub_oembed(monkeypatch, resp: _FakeResp):
    monkeypatch.setattr(enrich.httpx, "AsyncClient", lambda *a, **k: _FakeClient(resp))


OEMBED_OK = {
    "title": "Nightcore - We Made It (Lyrics)",
    "author_name": "Lilith",
    "thumbnail_url": "https://i.ytimg.com/vi/9k9TwgrSQIM/hqdefault.jpg",
}


async def test_falls_back_to_oembed_when_ytdlp_refused(no_ytdlp, monkeypatch):
    _stub_oembed(monkeypatch, _FakeResp(200, OEMBED_OK))

    enr = await enrich.enrich_youtube("https://www.youtube.com/watch?v=9k9TwgrSQIM")

    assert enr.kind == "youtube"
    assert enr.title == "Nightcore - We Made It (Lyrics)"
    assert enr.channel == "Lilith"
    assert enr.thumbnail_url.endswith("hqdefault.jpg")
    # oEmbed carries none of these, so they must stay empty rather than be faked.
    assert enr.duration_sec is None
    assert enr.published_at is None
    assert enr.description == ""
    # Partial result: still flagged so a later re-fetch can complete it.
    assert enr.needs_enrichment is True


async def test_oembed_non_200_leaves_item_unenriched(no_ytdlp, monkeypatch):
    # 401/404 = private, deleted or embedding disabled.
    _stub_oembed(monkeypatch, _FakeResp(404))

    enr = await enrich.enrich_youtube("https://www.youtube.com/watch?v=gone")

    assert enr.title == ""
    assert enr.needs_enrichment is True


async def test_oembed_transport_error_is_swallowed(no_ytdlp, monkeypatch):
    def _boom(*a, **k):
        raise RuntimeError("network down")

    monkeypatch.setattr(enrich.httpx, "AsyncClient", _boom)

    enr = await enrich.enrich_youtube("https://www.youtube.com/watch?v=9k9TwgrSQIM")

    assert enr.needs_enrichment is True


async def test_ytdlp_success_skips_oembed(monkeypatch):
    """A working yt-dlp must win outright — full metadata, no partial flag."""
    monkeypatch.setattr(enrich, "_ytdlp_metadata", lambda url: {
        "title": "Real Title",
        "description": "Real description",
        "uploader": "Real Channel",
        "thumbnail": "https://example.com/t.jpg",
        "duration": 147,
        "upload_date": "20230513",
    })

    def _fail(*a, **k):
        raise AssertionError("oembed must not be called when yt-dlp succeeds")

    monkeypatch.setattr(enrich.httpx, "AsyncClient", _fail)

    enr = await enrich.enrich_youtube("https://www.youtube.com/watch?v=9k9TwgrSQIM")

    assert enr.title == "Real Title"
    assert enr.duration_sec == 147
    assert enr.published_at == "2023-05-13"
    assert enr.needs_enrichment is False
