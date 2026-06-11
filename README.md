# yumi — personal library & tracker

yumi started as a replacement for YouTube's bookmark UX and grew into a general
local-first tracker for anything with a "get to it later" state. One pool of
items — links, videos, local files, freeform notes — carries namespaced tags
(`type:anime`, `game:gw2`, `score:nice`), and **Spaces** turn that pool into
purpose-specific views that each speak their own language.

In real use a single library tracks, side by side:

- **Media backlogs** — anime / manga / music Spaces with their own status
  vocabulary (`to watch / watching / watched`, `to read / reading / read`) and
  episode/chapter counters on serialized content.
- **Recurring game tasks** — GW2 dailies and meta-events as items that flip to
  *completed* during play and **reset back to *to do* on a schedule** (daily or
  weekly at a local wall-clock time, e.g. the 9 PM daily reset).
- **Study material, software lists, anything else** — a Space is just
  namespaces + required tags, so new domains need no schema changes.

Single-user, no auth, SQLite under the hood, FastAPI + React on top. Runs
locally on `127.0.0.1:8765`, or tailnet-only on a home server as an
installable full-screen PWA (see [deploy/DEPLOY.md](deploy/DEPLOY.md)).

## What it can do

**Items**
- Add any YouTube link, generic URL, local file path, or freeform note.
  Metadata auto-enriches via yt-dlp (YouTube) or OpenGraph/oEmbed (everything
  else); failures are flagged for one-click re-fetch.
- Four statuses (`plan / in-progress / completed / archived`) with per-Space
  display labels; progress/total counters for serialized media (which tags get
  a counter is configurable — Settings → Counter tags).
- Markdown notes per item, file attachments, full revision history with
  restore, soft delete with trash/restore/purge, duplicate detection (409 +
  "open existing"), open-click usage metrics.

**Tags**
- Namespaced and enforced (`ns:value`), with autocomplete, a grouped browse
  panel, and comma-list paste/copy.
- Boolean tag expressions in the filter sidebar: `AND` / `OR` / `NOT`,
  `-tag` shorthand, `"multi word"` quoting.
- Orphan tags (zero live items) are swept at startup and hourly.

**Spaces**
- Defined by namespaces + required tags; the sidebar tag browser scopes to the
  Space. Colon-named spaces (`Games: GW2`) group into dropdown menus.
- Custom labels for the three active statuses; `archived` stays fixed.
- **Saved filters**: named, live snapshots of the filter state (query, tag
  expression, statuses, sort) — always reflect the current library.
- **Scheduled resets**: per-Space rules that flip in-progress/completed items
  back to `plan` daily at HH:MM or weekly on a weekday (local time), optionally
  scoped to tags. Missed resets catch up at startup; a minute sweep applies
  them live.
- AI note templates managed per Space.

**Search** — SQLite FTS5 full-text over titles/descriptions/notes/channel,
combined with tag expressions, status filters, and sorts (recent / random /
duration / title).

**AI assistance (optional)** — on add, suggests tags and seeds notes (with a
review/edit flow); an inline notes assistant supports `@template` mentions.
Works with any OpenAI-compatible endpoint: declare providers via
`YUMI_AI_PROVIDER_<name>="url=…,key=…,model=…"` and a fallback order via
`YUMI_AI_ORDER`. Without providers configured, everything else works normally.

**Resilience** — automatic pre-migration DB snapshot on startup; the server
deploy adds a daily backup timer with rclone offsite copy. The whole library
is one SQLite file.

## Stack

- **Backend:** Python 3.11+ · FastAPI · SQLAlchemy 2 · SQLite (FTS5) · yt-dlp · httpx · selectolax
- **Frontend:** React 19 · Vite · TypeScript · Tailwind v4 · TanStack Query · React Router

## Quick start (Windows)

```powershell
.\run.cmd
```

That's it. On first run it installs the frontend deps, builds the SPA, creates a
Python virtualenv, installs the backend, and launches the server — then opens
<http://127.0.0.1:8765>.

### Dev mode (hot reload)

After at least one `run.cmd` (so the external venv exists):

```powershell
$venv = "$env:LOCALAPPDATA\sadirano\yumi\.venv\Scripts\python.exe"

# terminal 1 — backend
cd backend
& $venv -m uvicorn app.main:app --reload --port 8765

# terminal 2 — frontend
cd frontend
npm run dev        # http://localhost:5173, proxies /api to 8765
```

## Tests

```powershell
cd backend
& "$env:LOCALAPPDATA\sadirano\yumi\.venv\Scripts\python.exe" -m pytest
```

## Data

Your library lives **outside the repo** so nothing personal is ever committed.
The disposable venv lives under `sadirano\yumi`; the backup-worthy library
lives under a separate `sadirano-data` domain so backup tools can target it:

| OS      | Default location                                        |
| ------- | ------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\sadirano-data\yumi\favorites.sqlite`    |
| macOS   | `~/Library/Application Support/sadirano-data/yumi/favorites.sqlite` |
| Linux   | `$XDG_DATA_HOME/sadirano-data/yumi/favorites.sqlite` (or `~/.local/share/...`) |

The directory (and DB) is created automatically on first run. Back it up by
copying the `.sqlite` file — that's the whole library (plus `uploads/` for
attachments). Override the location with `YUMI_DATA_DIR=...`.

## License

MIT — see [LICENSE](LICENSE).

## API

OpenAPI docs at <http://127.0.0.1:8765/docs> when the server is running.

Quick reference:

```
POST   /api/items                    add (url, file_path, or note); 409 on duplicate
GET    /api/items?q=&tags=&tag_op=&exclude_tags=&status_in=&sort=&space_id=
GET    /api/items/{id}
PATCH  /api/items/{id}               partial update (title, notes_md, status, tags,
                                     progress, total, url, …); ?snapshot=false skips history
DELETE /api/items/{id}               soft delete
POST   /api/items/{id}/restore
DELETE /api/items/{id}/purge         hard delete from trash
POST   /api/items/{id}/refresh       re-enrich
POST   /api/items/{id}/access        count an open-the-resource click
GET    /api/items/{id}/revisions
POST   /api/items/{id}/revisions/{rev}/restore
GET/POST/DELETE /api/items/{id}/attachments[/{name}]

GET    /api/tags?prefix=             autocomplete
DELETE /api/tags/{name}

GET/POST        /api/spaces          spaces carry namespaces, required tags,
PATCH/DELETE    /api/spaces/{id}     labels, templates, and reset_rules
GET/POST        /api/spaces/{id}/filters
PATCH/DELETE    /api/saved-filters/{id}

GET    /api/trash
POST   /api/ai/ask                   {prompt} → {response}
```

## Tag expression syntax

In the Library sidebar's "Tag expression" box:

- `genre:rust type:tutorial` → items tagged with both (`AND` is the default)
- `genre:rust AND type:tutorial NOT level:beginner`
- `type:music OR type:podcast NOT live:yes`
- `-level:beginner` is shorthand for `NOT level:beginner`
- `"multi word"` becomes a single tag

## Out of scope (for now)

- Browser extension / bookmarklet
- Bookmark or YT-takeout import
- Watch-position resume tracking
- JSON / Markdown export
- Auth, multi-user
