import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { parseTagQuery } from "../lib/tagQuery";
import type { Space, Tag } from "../api/client";

const STATUSES = ["to-watch", "watching", "watched", "archived"] as const;
const SORTS = ["recent", "random", "duration", "title"] as const;

export default function FilterSidebar() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [tagExpr, setTagExpr] = useState(sp.get("tagExpr") ?? "");
  const statuses = (sp.get("status_in") ?? "").split(",").filter(Boolean);
  const sort = sp.get("sort") ?? "recent";

  useEffect(() => { setQ(sp.get("q") ?? ""); }, [sp]);

  function commit(next: URLSearchParams) {
    for (const k of Array.from(next.keys())) if (!next.get(k)) next.delete(k);
    setSp(next, { replace: true });
  }

  function applyText(value: string) {
    const next = new URLSearchParams(sp);
    if (value) next.set("q", value); else next.delete("q");
    commit(next);
  }

  function applyTagExpr(value: string) {
    const next = new URLSearchParams(sp);
    next.set("tagExpr", value);
    const parsed = parseTagQuery(value);
    if (parsed.tags.length) next.set("tags", parsed.tags.join(",")); else next.delete("tags");
    if (parsed.exclude_tags.length) next.set("exclude_tags", parsed.exclude_tags.join(",")); else next.delete("exclude_tags");
    next.set("tag_op", parsed.tag_op);
    commit(next);
  }

  useEffect(() => {
    const t = setTimeout(() => applyText(q), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const t = setTimeout(() => applyTagExpr(tagExpr), 300);
    return () => clearTimeout(t);
  }, [tagExpr]);

  function toggleStatus(s: string) {
    const cur = new Set(statuses);
    if (cur.has(s)) cur.delete(s); else cur.add(s);
    const next = new URLSearchParams(sp);
    if (cur.size) next.set("status_in", Array.from(cur).join(",")); else next.delete("status_in");
    commit(next);
  }

  function setSort(s: string) {
    const next = new URLSearchParams(sp);
    next.set("sort", s);
    commit(next);
  }

  function clearAll() {
    setQ("");
    setTagExpr("");
    setSp(new URLSearchParams(), { replace: true });
  }

  const parsed = useMemo(() => parseTagQuery(tagExpr), [tagExpr]);

  const spaceId = sp.get("space") ? Number(sp.get("space")) : null;

  const { data: allSpaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });

  const activeSpace: Space | undefined = allSpaces.find(s => s.id === spaceId);

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.listTags(),
    staleTime: 30_000,
  });

  const grouped = useMemo(() => {
    const map: Record<string, Tag[]> = {};
    const spaceNs = activeSpace?.namespaces ?? null;
    for (const t of allTags) {
      const colon = t.name.indexOf(":");
      const ns = colon > 0 ? t.name.slice(0, colon) : "";
      if (spaceNs !== null && ns !== "" && !spaceNs.includes(ns)) continue;
      if (spaceNs !== null && ns === "") continue;
      (map[ns] ??= []).push(t);
    }
    for (const ns in map) {
      map[ns].sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1));
    }
    return Object.entries(map).sort(([a], [b]) => {
      if (a === "" && b !== "") return 1;
      if (b === "" && a !== "") return -1;
      return a < b ? -1 : 1;
    });
  }, [allTags, activeSpace]);

  function toggleTag(name: string) {
    const active = new Set(parsed.tags);
    if (active.has(name)) {
      const next = [...parsed.tags.filter(t => t !== name), ...parsed.exclude_tags.map(t => `-${t}`)];
      setTagExpr(next.join(parsed.tag_op === "OR" ? " OR " : " AND "));
    } else {
      setTagExpr(prev => prev.trim() ? `${prev.trim()} AND ${name}` : name);
    }
  }

  return (
    <aside className="w-64 shrink-0 border-r border-zinc-800 p-3 space-y-4 text-sm overflow-y-auto">
      <div>
        <label className="text-xs uppercase text-zinc-500">Search</label>
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="full-text in titles & notes"
          className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5"
        />
      </div>

      <div>
        <label className="text-xs uppercase text-zinc-500">Tag expression</label>
        <input
          value={tagExpr}
          onChange={e => setTagExpr(e.target.value)}
          placeholder="genre:romance AND source:manga"
          className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 font-mono text-xs"
        />
        <p className="text-[10px] text-zinc-500 mt-1">AND / OR / NOT · -tag excludes · namespace:value</p>
      </div>

      {grouped.length > 0 && (
        <div>
          <label className="text-xs uppercase text-zinc-500">Tags</label>
          <div className="mt-1 space-y-2.5 max-h-72 overflow-y-auto pr-0.5">
            {grouped.map(([ns, tags]) => (
              <div key={ns || "__other__"}>
                {ns && (
                  <div className="text-[10px] text-zinc-500 mb-1 uppercase tracking-wide">{ns}</div>
                )}
                <div className="flex flex-wrap gap-1">
                  {tags.map(({ name, count }) => {
                    const val = ns ? name.slice(ns.length + 1) : name;
                    const active = parsed.tags.includes(name);
                    return (
                      <button
                        key={name}
                        onClick={() => toggleTag(name)}
                        className={`px-2 py-0.5 rounded text-xs transition ${
                          active
                            ? "bg-blue-600 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                        }`}
                      >
                        {val}
                        <span className="ml-1 text-[10px] opacity-60">{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <label className="text-xs uppercase text-zinc-500">Status</label>
        <div className="flex flex-wrap gap-1 mt-1">
          {STATUSES.map(s => (
            <button
              key={s}
              onClick={() => toggleStatus(s)}
              className={`px-2 py-1 rounded text-xs ${statuses.includes(s) ? "bg-blue-600" : "bg-zinc-800 text-zinc-400"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs uppercase text-zinc-500">Sort</label>
        <select
          value={sort}
          onChange={e => setSort(e.target.value)}
          className="w-full mt-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5"
        >
          {SORTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      <button onClick={clearAll} className="text-xs text-zinc-400 hover:text-zinc-100 underline">
        clear filters
      </button>
    </aside>
  );
}
