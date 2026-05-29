from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from dataclasses import dataclass
from typing import Optional
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse

import httpx
from selectolax.parser import HTMLParser

from .settings import settings

_MAX_REDIRECTS = 5


class UnsafeURLError(Exception):
    """Raised when a URL targets a non-public address (SSRF guard)."""


def _assert_public_url(url: str) -> None:
    """Reject anything that isn't a plain http(s) URL pointing at a public host.

    Guards the metadata fetcher against SSRF: no file://, no internal/loopback/
    link-local/cloud-metadata addresses. Resolves the hostname and checks every
    address it maps to.
    """
    p = urlparse(url)
    if p.scheme not in ("http", "https"):
        raise UnsafeURLError(f"scheme not allowed: {p.scheme!r}")
    host = p.hostname
    if not host:
        raise UnsafeURLError("missing host")
    try:
        infos = socket.getaddrinfo(host, p.port or (443 if p.scheme == "https" else 80))
    except socket.gaierror as exc:
        raise UnsafeURLError(f"cannot resolve host: {host}") from exc
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise UnsafeURLError(f"host resolves to non-public address: {ip}")


YOUTUBE_HOSTS = {
    "youtube.com", "www.youtube.com", "m.youtube.com",
    "music.youtube.com", "youtu.be",
}


@dataclass
class Enrichment:
    kind: str
    title: str = ""
    description: str = ""
    channel: str = ""
    thumbnail_url: Optional[str] = None
    duration_sec: Optional[int] = None
    published_at: Optional[str] = None
    canonical_url: Optional[str] = None
    needs_enrichment: bool = False


def _yt_id(url: str) -> Optional[str]:
    p = urlparse(url)
    host = p.hostname or ""
    if host == "youtu.be":
        vid = p.path.lstrip("/").split("/")[0]
        return vid or None
    if host.endswith("youtube.com"):
        if p.path == "/watch":
            return parse_qs(p.query).get("v", [None])[0]
        m = re.match(r"^/(shorts|embed|live|v)/([^/]+)", p.path)
        if m:
            return m.group(2)
    return None


def normalize_url(url: str) -> str:
    url = url.strip()
    yt = _yt_id(url)
    if yt:
        return f"https://www.youtube.com/watch?v={yt}"
    p = urlparse(url)
    if not p.scheme:
        url = "https://" + url
        p = urlparse(url)
    return urlunparse((p.scheme.lower(), (p.netloc or "").lower(), p.path or "/", "", p.query, ""))


def is_youtube(url: str) -> bool:
    return (urlparse(url).hostname or "") in YOUTUBE_HOSTS


def _ytdlp_metadata(url: str) -> dict | None:
    try:
        from yt_dlp import YoutubeDL
    except Exception:
        return None
    opts = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "noplaylist": True,
        "extract_flat": False,
        "socket_timeout": int(settings.enrichment_timeout_sec),
    }
    try:
        with YoutubeDL(opts) as ydl:
            return ydl.extract_info(url, download=False)
    except Exception:
        return None


async def enrich_youtube(url: str) -> Enrichment:
    loop = asyncio.get_running_loop()
    info = await loop.run_in_executor(None, _ytdlp_metadata, url)
    if not info:
        return Enrichment(kind="youtube", canonical_url=url, needs_enrichment=True)

    thumb = info.get("thumbnail")
    if not thumb and info.get("thumbnails"):
        thumb = info["thumbnails"][-1].get("url")

    pub = info.get("upload_date") or info.get("release_date")
    if pub and len(pub) == 8 and pub.isdigit():
        pub = f"{pub[0:4]}-{pub[4:6]}-{pub[6:8]}"

    return Enrichment(
        kind="youtube",
        title=info.get("title", "") or "",
        description=(info.get("description") or "")[:2000],
        channel=info.get("uploader") or info.get("channel") or "",
        thumbnail_url=thumb,
        duration_sec=int(info["duration"]) if info.get("duration") else None,
        published_at=pub,
        canonical_url=url,
    )


async def enrich_generic_url(url: str) -> Enrichment:
    try:
        # Follow redirects manually so every hop is re-validated against the
        # SSRF guard (a public URL can otherwise redirect into the internal net).
        async with httpx.AsyncClient(
            follow_redirects=False,
            timeout=settings.enrichment_timeout_sec,
            headers={"User-Agent": "yumi/0.1 (+local)"},
        ) as client:
            current = url
            for _ in range(_MAX_REDIRECTS + 1):
                _assert_public_url(current)
                r = await client.get(current)
                if r.is_redirect and r.has_redirect_location:
                    current = urljoin(current, r.headers["location"])
                    continue
                r.raise_for_status()
                html = HTMLParser(r.text)
                break
            else:
                raise UnsafeURLError("too many redirects")
    except Exception:
        return Enrichment(kind="url", canonical_url=url, needs_enrichment=True)

    def meta(prop: str) -> str:
        node = html.css_first(f'meta[property="{prop}"]') or html.css_first(f'meta[name="{prop}"]')
        return (node.attributes.get("content") or "").strip() if node else ""

    title = meta("og:title") or (html.css_first("title").text() if html.css_first("title") else "")
    desc = meta("og:description") or meta("description")
    thumb = meta("og:image") or None
    channel = meta("og:site_name")

    return Enrichment(
        kind="url",
        title=title.strip(),
        description=desc.strip()[:2000],
        channel=channel.strip(),
        thumbnail_url=thumb,
        canonical_url=url,
    )


async def enrich_url(url: str) -> Enrichment:
    norm = normalize_url(url)
    if is_youtube(norm):
        return await enrich_youtube(norm)
    return await enrich_generic_url(norm)
