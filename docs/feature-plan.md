# Yumi — Feature Implementation Plan

Four features scoped from the 2026-05-31 feasibility discussion. Bulk tag-adding was
deferred; the `source` field is being scrapped.

## Implementation status (2026-05-31)

Implemented on branch `feature/status-labels-metrics` (uncommitted). Gates green:
`pytest` (15), `tsc -b`, `vite build`. Deviations from the plan as written:

- **AniList (#3)** was already present in the codebase (`anilist_id` field, link-out,
  related-links) — no new work needed beyond scrapping `source`.
- **`source`** is removed from the API surface and UI but left as a **dead DB column**
  (kept `NOT NULL`, never read) to avoid a table rebuild. Can be dropped later if wanted.
- New shared `frontend/src/lib/status.ts` centralizes the status maps + `statusLabel`.
- Access endpoint returns `204` and uses a raw SQL `UPDATE` so it never bumps
  `updated_at` (opening a link must not re-sort the library).

## Scope summary

| # | Feature | Layer | Size |
|---|---------|-------|------|
| 2 | Rename statuses + per-Space custom labels | back + front | Medium |
| 1+3 | Open-link always visible, delete moved to detail | front | Small |
| 3 | Scrap `source`, add typed `anilist_id` | back + front | Small |
| 5 | Per-item access count + last-accessed | back + front | Small |

The label map (#2), `anilist_id` (#3), and the two metrics columns (#5) are all the same
`ADD COLUMN` + schema-surface pattern — do them in one backend pass.

### Key decisions locked in

- **Statuses:** clean rename to canonical `plan / in-progress / completed / archived`. No
  legacy `to-watch` naming carried forward. The rename is a clean 1:1 map, so existing data
  is backfilled and nothing is lost.
- **Labels:** per-Space free-text labels for the 3 active states only. `archived` stays fixed.
  Unscoped Library shows canonical defaults; a Space with labels uses its own; on multi-Space
  match the active Space wins, falling back to canonical.
- **AniList:** the consume link (where you watch/read/listen) stays the primary, always-visible,
  click-counted destination. AniList is a typed `anilist_id` field rendered as a badge + secondary
  link-out — not the main link. (Leaves room for AniList enrichment later; out of scope now.)
- **Delete:** removed from the card entirely; only reachable from the item detail page.
- **Metrics:** an access = a click of the consume link, counted wherever pressed (card or detail).
  Count + last-accessed displayed on the detail page only, for now. Curiosity-driven.

---

## Phase 1 — Backend data layer (one pass)

**`db.py`** (runtime `ADD COLUMN`, no Alembic — matching existing pattern):
- `Space.labels_json` — nullable; stores `{plan, in-progress, completed}` → custom label.
- `Item.anilist_id` — nullable text.
- `Item.access_count` — int, default 0.
- `Item.last_accessed_at` — nullable datetime.
- **Status backfill** (idempotent, only maps known old values): across `items.status`,
  `item_revisions.status`, and `space_filters.params_json`'s `status_in` arrays:
  `to-watch → plan`, `watching → in-progress`, `watched → completed`, `archived → archived`.

**`models.py` / `schemas.py`:**
- Update the status `Literal` to the new canonical strings (Item + ItemRevision).
- Add `anilist_id`, `access_count`, `last_accessed_at` to `Item`; mirror `anilist_id` onto
  `ItemRevision` for history consistency.
- Add `labels_json` to `Space` + `SpaceOut` / `SpacePatch`.
- Add the new Item fields to `ItemOut`; `anilist_id` to `ItemPatch`.
- **Remove `source`** from `ItemOut` / `ItemPatch` and stop reading it.
  Micro-decision: leave the dead DB column rather than dropping it — zero risk, invisible anyway.

**`routers/items.py`:**
- New `POST /items/{id}/access` — increments `access_count`, sets `last_accessed_at`, writes
  with `snapshot: false` (no revision spam).

## Phase 2 — Status labels (frontend)

- Update the TS status union + the 3 frontend lookup maps to the new canonical strings.
- **Label resolver** helper: `(activeSpace, canonicalStatus) → displayLabel` — uses the active
  Space's `labels_json` if set, else the canonical default (`plan / in progress / completed`);
  `archived` is always "archived". Thread it through `ItemCard`, `ItemDetail`, and the filter sidebar.
- Space settings UI: 3 free-text inputs to set the labels.

## Phase 3 — Card interaction (#1 + #3-delete)

`ItemCard.tsx` only:
- Extract the open-resource (`↗`) control out of the hover cluster → **always visible**.
  Render nothing for note/linkless items.
- **Remove delete from the card entirely.** Leave tags / ✓ / +1 on hover as-is. Confirm delete
  is reachable on `ItemDetail` (add it there if not).

## Phase 4 — AniList (#3)

- `ItemDetail`: remove the `source` input; add an `anilist_id` input → renders a **link-out** +
  a **badge/tag**.
- `ItemCard`: show the AniList badge when `anilist_id` is set.
- Manual entry for now.

## Phase 5 — Metrics (#5)

- Fire `POST /items/{id}/access` on every click of the **consume link**, both on the card and in
  detail (same intent).
- `ItemDetail`: display `access_count` and `last_accessed_at`.

---

## Notes & risks

- **The status backfill is the one step needing care** — make it idempotent (map only recognized
  old values) so re-running on startup is safe. Everything else is additive.
- **The always-visible open-link button and the metric click are the same control** — wire the
  access-ping into that one handler and both #1 and #5 are served.
- `space_filters.params_json` stores status/tag values as raw strings with no referential
  integrity. The status backfill must include it, or saved filters silently empty. Same fragility
  applies to any future tag rename.
- Suggested commit/PR boundaries to stay out of the way of in-flight work:
  1. backend column batch + backfill + access endpoint
  2. status label frontend
  3. card interaction
  4. AniList
  5. metrics display

  Each is independently shippable.

## Relevant files

- Backend: `backend/app/models.py`, `schemas.py`, `db.py`, `routers/items.py`
- Frontend: `frontend/src/components/ItemCard.tsx`, `FilterSidebar.tsx`,
  `pages/Library.tsx`, `pages/ItemDetail.tsx`, `api/client.ts`
