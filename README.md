# yumi — Personal Favorites Library

A local-first replacement for YouTube's bookmark UX. Save any YouTube link (or any URL, local file, or freeform note) with tags, markdown notes, and status, then organize them into Spaces with per-Space saved filters — named, live tag queries that always reflect the current library. Full-text search + boolean tag queries. SQLite under the hood, FastAPI + React on top.

Runs on `127.0.0.1:8765`, single-user, no auth.

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

The virtualenv and your library both live **outside the repo**, under a per-user
`sadirano\yumi` home, so the source tree stays clean:

- venv → `%LOCALAPPDATA%\sadirano\yumi\.venv`
- data → `%LOCALAPPDATA%\sadirano\yumi\favorites.sqlite`

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

Your library lives **outside the repo**, in a per-user data directory under a shared `sadirano` domain folder, so the source tree stays clean and nothing personal is ever committed:

| OS      | Default location                                        |
| ------- | ------------------------------------------------------- |
| Windows | `%LOCALAPPDATA%\sadirano\yumi\favorites.sqlite`         |
| macOS   | `~/Library/Application Support/sadirano/yumi/favorites.sqlite` |
| Linux   | `$XDG_DATA_HOME/sadirano/yumi/favorites.sqlite` (or `~/.local/share/...`) |

The directory (and DB) is created automatically on first run. Back it up by copying the `.sqlite` file — that's the whole library. Override the location with `YUMI_DATA_DIR=...`.

## License

MIT — see [LICENSE](LICENSE).

## API

OpenAPI docs at <http://127.0.0.1:8765/docs> when the server is running.

Quick reference:

```
POST   /api/items                    add (url, file_path, or note); 409 on duplicate
GET    /api/items?q=&tags=&tag_op=&exclude_tags=&status_in=&sort=
GET    /api/items/{id}
PATCH  /api/items/{id}               partial update (title, notes_md, status, source, tags)
DELETE /api/items/{id}               soft delete
POST   /api/items/{id}/restore
DELETE /api/items/{id}/purge         hard delete from trash
POST   /api/items/{id}/refresh       re-enrich

GET    /api/tags?prefix=             autocomplete
DELETE /api/tags/{name}

GET    /api/spaces/{space_id}/filters
POST   /api/spaces/{space_id}/filters             {name, params}
PATCH  /api/saved-filters/{id}                     {name?, params?}
DELETE /api/saved-filters/{id}

GET    /api/trash
```

## Tag expression syntax

In the Library sidebar's "Tag expression" box:

- `rust tutorial` → items tagged with both (`AND` is the default)
- `rust AND tutorial NOT beginner`
- `music OR podcast NOT live`
- `-beginner` is shorthand for `NOT beginner`
- `"multi word"` becomes a single tag

## Out of scope (for now)

- Browser extension / bookmarklet
- Bookmark or YT-takeout import
- Watch-position resume tracking
- JSON/Markdown export and scheduled backups
- Auth or multi-user
