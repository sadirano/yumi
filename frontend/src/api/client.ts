export type ItemKind = "youtube" | "url" | "file" | "note";
export type ItemStatus = "plan" | "in-progress" | "completed" | "archived";

export interface Tag { id: number; name: string; count: number }

export interface RelatedLink { label: string; url: string }

export interface Item {
  id: number;
  kind: ItemKind;
  url: string | null;
  file_path: string | null;
  title: string;
  description: string;
  notes_md: string;
  thumbnail_url: string | null;
  channel: string;
  duration_sec: number | null;
  published_at: string | null;
  status: ItemStatus;
  progress: number;
  total: number | null;
  anilist_id: number | null;
  related_links: RelatedLink[];
  needs_enrichment: boolean;
  access_count: number;
  last_accessed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  tags: Tag[];
}

export interface SavedFilter {
  id: number;
  space_id: number;
  name: string;
  params: Record<string, string>;
  created_at: string;
}

export interface Revision {
  id: number;
  item_id: number;
  title: string;
  notes_md: string;
  tags_json: string;
  status: string;
  created_at: string;
}

export interface ItemCreate {
  url?: string;
  file_path?: string;
  note_title?: string;
  note_body?: string;
  tags?: string[];
  status?: ItemStatus;
  notes_md?: string;
}

export interface ItemPatch {
  title?: string;
  notes_md?: string;
  status?: ItemStatus;
  tags?: string[];
  description?: string;
  thumbnail_url?: string | null;
  progress?: number;
  total?: number | null;
  anilist_id?: number | null;
  related_links?: RelatedLink[];
}

export interface Space {
  id: number;
  name: string;
  namespaces: string[];
  tags: string[];
  // Per-Space display labels for the 3 active statuses; null = canonical defaults.
  labels: Record<string, string> | null;
  created_at: string;
}

export interface ItemQuery {
  q?: string;
  tags?: string[];
  tag_op?: "AND" | "OR";
  exclude_tags?: string[];
  status_in?: ItemStatus[];
  sort?: "recent" | "random" | "duration" | "title";
  limit?: number;
  offset?: number;
  space_id?: number;
}

const BASE = "/api";

export class ApiError extends Error {
  constructor(public status: number, public body: any) {
    super(`API ${status}`);
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    let parsed: any = null;
    try { parsed = await r.json(); } catch { /* noop */ }
    throw new ApiError(r.status, parsed);
  }
  if (r.status === 204) return undefined as T;
  return (await r.json()) as T;
}

function qs(q: ItemQuery): string {
  const p = new URLSearchParams();
  if (q.q) p.set("q", q.q);
  if (q.tags?.length) p.set("tags", q.tags.join(","));
  if (q.tag_op) p.set("tag_op", q.tag_op);
  if (q.exclude_tags?.length) p.set("exclude_tags", q.exclude_tags.join(","));
  if (q.status_in?.length) p.set("status_in", q.status_in.join(","));
  if (q.sort) p.set("sort", q.sort);
  if (q.limit != null) p.set("limit", String(q.limit));
  if (q.offset != null) p.set("offset", String(q.offset));
  if (q.space_id != null) p.set("space_id", String(q.space_id));
  const s = p.toString();
  return s ? "?" + s : "";
}

export const api = {
  listItems: (q: ItemQuery = {}) => req<Item[]>("GET", `/items${qs(q)}`),
  getItem: (id: number) => req<Item>("GET", `/items/${id}`),
  createItem: (body: ItemCreate) => req<Item>("POST", `/items`, body),
  patchItem: (id: number, body: ItemPatch, opts?: { snapshot?: boolean }) =>
    req<Item>("PATCH", `/items/${id}${opts?.snapshot === false ? "?snapshot=false" : ""}`, body),
  deleteItem: (id: number) => req<void>("DELETE", `/items/${id}`),
  restoreItem: (id: number) => req<Item>("POST", `/items/${id}/restore`),
  purgeItem: (id: number) => req<void>("DELETE", `/items/${id}/purge`),
  refreshItem: (id: number) => req<Item>("POST", `/items/${id}/refresh`),
  // Records one explicit open-the-resource click (usage metrics). Fire-and-forget.
  pingAccess: (id: number) => req<void>("POST", `/items/${id}/access`),

  uploadItemFile: (itemId: number, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch(`${BASE}/items/${itemId}/uploads`, { method: "POST", body })
      .then(r => r.ok ? r.json() as Promise<{ url: string }> : Promise.reject(r));
  },

  listAttachments: (itemId: number) =>
    req<{ name: string; size: number; url: string }[]>("GET", `/items/${itemId}/attachments`),
  uploadAttachment: (itemId: number, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return fetch(`${BASE}/items/${itemId}/attachments`, { method: "POST", body })
      .then(r => r.ok ? r.json() as Promise<{ name: string; size: number; url: string }> : Promise.reject(r));
  },
  deleteAttachment: (itemId: number, name: string) =>
    req<void>("DELETE", `/items/${itemId}/attachments/${encodeURIComponent(name)}`),

  listTags: (prefix?: string) =>
    req<Tag[]>("GET", `/tags${prefix ? `?prefix=${encodeURIComponent(prefix)}` : ""}`),
  deleteTag: (name: string) => req<void>("DELETE", `/tags/${encodeURIComponent(name)}`),

  listSpaceFilters: (spaceId: number) => req<SavedFilter[]>("GET", `/spaces/${spaceId}/filters`),
  createSpaceFilter: (spaceId: number, name: string, params: Record<string, string>) =>
    req<SavedFilter>("POST", `/spaces/${spaceId}/filters`, { name, params }),
  updateSpaceFilter: (id: number, data: { name?: string; params?: Record<string, string> }) =>
    req<SavedFilter>("PATCH", `/saved-filters/${id}`, data),
  deleteSpaceFilter: (id: number) => req<void>("DELETE", `/saved-filters/${id}`),

  listTrash: () => req<Item[]>("GET", `/trash`),

  listRevisions: (itemId: number) => req<Revision[]>("GET", `/items/${itemId}/revisions`),
  restoreRevision: (itemId: number, revId: number) => req<Item>("POST", `/items/${itemId}/revisions/${revId}/restore`),

  listSpaces: () => req<Space[]>("GET", `/spaces`),
  createSpace: (name: string, namespaces: string[], tags: string[], labels?: Record<string, string> | null) =>
    req<Space>("POST", `/spaces`, { name, namespaces, tags, labels }),
  updateSpace: (id: number, data: { name?: string; namespaces?: string[]; tags?: string[]; labels?: Record<string, string> | null }) =>
    req<Space>("PATCH", `/spaces/${id}`, data),
  deleteSpace: (id: number) => req<void>("DELETE", `/spaces/${id}`),
};


/** The external link an item points at, or null if it has none (e.g. notes).
 *  file items become a file:/// URL; browsers may block opening these. */
export function itemLink(item: Item): string | null {
  if (item.url) return item.url;
  if (item.file_path) return encodeURI("file:///" + item.file_path.replace(/\\/g, "/"));
  return null;
}

export function fmtDuration(sec: number | null): string {
  if (!sec) return "";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}
