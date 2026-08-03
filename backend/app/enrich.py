from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import os
import re
import shutil
import socket
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urljoin, urlparse, urlunparse

import httpx
from selectolax.parser import HTMLParser

from .settings import settings

log = logging.getLogger(__name__)

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

YOUTUBE_OEMBED = "https://www.youtube.com/oembed"


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


def _ytdlp_exe() -> str | None:
    """Locate a yt-dlp executable: explicit override, then PATH (Scoop shim)."""
    explicit = os.environ.get("YUMI_YTDLP_EXE")
    if explicit and Path(explicit).exists():
        return explicit
    return shutil.which("yt-dlp")


def _ytdlp_via_exe(url: str) -> dict | None:
    """Fetch metadata by shelling out to yt-dlp.exe (`-J` = dump single JSON).

    This is the path used by the frozen build, which excludes the yt-dlp library
    to stay small and relies on a yt-dlp.exe declared as a Scoop dependency. The
    `-J` info dict carries the same keys the library's extract_info() returns.
    """
    exe = _ytdlp_exe()
    if not exe:
        log.warning("yt-dlp exe not found (set YUMI_YTDLP_EXE or put yt-dlp on PATH)")
        return None
    cmd = [
        exe, "-J", "--skip-download", "--no-playlist", "--no-warnings",
        "--socket-timeout", str(int(settings.enrichment_timeout_sec)), url,
    ]
    # CREATE_NO_WINDOW keeps a console from flashing when the server runs windowed.
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=settings.enrichment_timeout_sec + 5,
            creationflags=creationflags,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        log.warning(f"yt-dlp exe failed to run for {url}: {exc}")
        return None
    if proc.returncode != 0 or not proc.stdout.strip():
        # yt-dlp puts the actual reason on stderr ("Sign in to confirm you're not
        # a bot", "Video unavailable", ...); without it a failure is unreadable.
        log.warning(
            f"yt-dlp exe returned {proc.returncode} for {url}: "
            f"{(proc.stderr or '').strip()[:500]}"
        )
        return None
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        log.warning(f"yt-dlp exe emitted unparseable JSON for {url}: {exc}")
        return None


def _ytdlp_via_lib(url: str) -> dict | None:
    try:
        from yt_dlp import YoutubeDL
    except Exception as exc:
        log.warning(f"yt-dlp library unavailable: {exc}")
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
    except Exception as exc:
        log.warning(f"yt-dlp library failed for {url}: {exc}")
        return None


def _ytdlp_metadata(url: str) -> dict | None:
    """Resolve YouTube metadata via the library (dev) or yt-dlp.exe (frozen).

    The frozen build has no yt-dlp library, so it must use the exe; setting
    YUMI_YTDLP_EXE also forces the exe path so it can be exercised in dev before
    it ships inside an exe. Either way we fall back to the other source.
    """
    prefer_exe = getattr(sys, "frozen", False) or bool(os.environ.get("YUMI_YTDLP_EXE"))
    if prefer_exe:
        return _ytdlp_via_exe(url) or _ytdlp_via_lib(url)
    return _ytdlp_via_lib(url) or _ytdlp_via_exe(url)


async def _youtube_oembed(url: str) -> dict | None:
    """Fetch what YouTube's public oEmbed endpoint carries: title, channel, thumb.

    This is YouTube's own documented endpoint for third-party embeds, needs no
    auth, and is not subject to the bot challenge that refuses yt-dlp from
    datacenter IPs — which makes it the one source that still answers there. It
    has no duration, description or publish date, so callers treat a result as
    partial rather than a full enrichment.
    """
    try:
        async with httpx.AsyncClient(timeout=settings.enrichment_timeout_sec) as client:
            r = await client.get(YOUTUBE_OEMBED, params={"url": url, "format": "json"})
        if r.status_code != 200:
            # 401/404 here means private, deleted or embedding-disabled.
            log.warning(f"youtube oembed returned {r.status_code} for {url}")
            return None
        return r.json()
    except Exception as exc:
        log.warning(f"youtube oembed failed for {url}: {type(exc).__name__}: {exc}")
        return None


async def enrich_youtube(url: str) -> Enrichment:
    loop = asyncio.get_running_loop()
    info = await loop.run_in_executor(None, _ytdlp_metadata, url)
    if not info:
        # yt-dlp refused (usually a bot challenge). oEmbed still answers, so take
        # the subset it carries rather than leaving the item titled with its URL.
        log.warning(f"yt-dlp produced nothing for {url}; falling back to oembed")
        oe = await _youtube_oembed(url)
        if not oe:
            log.warning(f"youtube enrichment produced nothing for {url}; item marked needs_enrichment")
            return Enrichment(kind="youtube", canonical_url=url, needs_enrichment=True)
        return Enrichment(
            kind="youtube",
            title=oe.get("title") or "",
            channel=oe.get("author_name") or "",
            thumbnail_url=oe.get("thumbnail_url") or None,
            canonical_url=url,
            # Partial by construction — no duration/description/published_at — so
            # the item stays flagged for a later re-fetch that may get through.
            needs_enrichment=True,
        )

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
    m = re.search(r"anilist\.co/(anime|manga)/(\d+)", url)
    if m:
        media_type = m.group(1).upper()
        media_id = m.group(2)
        query = """
        query ($id: Int, $type: MediaType) {
          Media(id: $id, type: $type) {
            title { romaji english }
            description(asHtml: false)
            genres
            tags { name }
            coverImage { large }
          }
        }
        """
        try:
            async with httpx.AsyncClient(timeout=settings.enrichment_timeout_sec) as client:
                r = await client.post(
                    "https://graphql.anilist.co",
                    json={"query": query, "variables": {"id": int(media_id), "type": media_type}}
                )
                if r.status_code == 200:
                    data = r.json().get("data", {}).get("Media")
                    if data:
                        title = data["title"].get("english") or data["title"].get("romaji") or ""
                        desc = data.get("description") or ""
                        
                        extra = []
                        if data.get("genres"):
                            extra.append("Genres: " + ", ".join(data["genres"]))
                        if data.get("tags"):
                            extra.append("Tags: " + ", ".join(t["name"] for t in data["tags"]))
                            
                        if extra:
                            desc = desc + "\n\n" + "\n".join(extra)
                            
                        thumb = None
                        if data.get("coverImage"):
                            thumb = data["coverImage"].get("large")
                            
                        return Enrichment(
                            kind="url",
                            title=title,
                            description=desc[:2000],
                            channel="AniList",
                            thumbnail_url=thumb,
                            canonical_url=url,
                        )
        except Exception as exc:
            # Fall through to the generic og:-tag scrape below.
            log.warning(f"anilist lookup failed for {url}: {type(exc).__name__}: {exc}")

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
    except Exception as exc:
        log.warning(f"url enrichment failed for {url}: {type(exc).__name__}: {exc}")
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
