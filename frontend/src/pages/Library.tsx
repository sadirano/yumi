import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { api, Item, ItemQuery, ItemStatus } from "../api/client";
import FilterSidebar from "../components/FilterSidebar";
import ItemCard, { Layout } from "../components/ItemCard";

function LayoutBtn({ active, title, onClick, children }: {
  active: boolean;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded transition ${active ? "bg-zinc-700 text-white" : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"}`}
    >
      {children}
    </button>
  );
}

export default function Library() {
  const [sp] = useSearchParams();
  const qc = useQueryClient();
  const [layout, setLayout] = useState<Layout>(() =>
    (localStorage.getItem("library-layout") as Layout) || "normal"
  );

  function changeLayout(l: Layout) {
    setLayout(l);
    localStorage.setItem("library-layout", l);
  }

  const query: ItemQuery = useMemo(() => {
    const q: ItemQuery = {};
    const s = sp.get("q"); if (s) q.q = s;
    const t = sp.get("tags"); if (t) q.tags = t.split(",");
    const e = sp.get("exclude_tags"); if (e) q.exclude_tags = e.split(",");
    const op = sp.get("tag_op"); if (op === "OR" || op === "AND") q.tag_op = op;
    const stat = sp.get("status_in"); if (stat) q.status_in = stat.split(",") as ItemStatus[];
    const sort = sp.get("sort") as ItemQuery["sort"] | null;
    if (sort) q.sort = sort;
    const spaceParam = sp.get("space"); if (spaceParam) q.space_id = Number(spaceParam);
    q.limit = 120;
    return q;
  }, [sp]);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["items", query],
    queryFn: () => api.listItems(query),
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });

  const toggleWatched = useMutation({
    mutationFn: (it: Item) => {
      const cycle: Record<string, ItemStatus> = { "to-watch": "watching", "watching": "watched", "watched": "to-watch", "archived": "to-watch" };
      return api.patchItem(it.id, { status: cycle[it.status] ?? "watching" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["items"] }),
  });

  // Inline tag edits are "lightweight": skip revision history so quick triage
  // doesn't spam each item's history.
  const editTags = useMutation({
    mutationFn: ({ id, tags }: { id: number; tags: string[] }) =>
      api.patchItem(id, { tags }, { snapshot: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
    },
  });

  const gridClass = {
    normal: "grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]",
    big: "grid gap-4 grid-cols-[repeat(auto-fill,minmax(340px,1fr))]",
    detailed: "flex flex-col gap-2",
  }[layout];

  return (
    <div className="flex h-[calc(100vh-2.75rem)]">
      <FilterSidebar />
      <div className="flex-1 overflow-y-auto">
        <div className="sticky top-0 bg-zinc-950/95 backdrop-blur z-10 px-4 py-2 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-sm text-zinc-400">{items.length} item{items.length === 1 ? "" : "s"}</span>
          <div className="flex gap-0.5">
            <LayoutBtn active={layout === "normal"} title="Normal grid" onClick={() => changeLayout("normal")}>
              {/* 3x3 small grid */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="4" height="4" rx="0.5"/>
                <rect x="6" y="1" width="4" height="4" rx="0.5"/>
                <rect x="11" y="1" width="4" height="4" rx="0.5"/>
                <rect x="1" y="6" width="4" height="4" rx="0.5"/>
                <rect x="6" y="6" width="4" height="4" rx="0.5"/>
                <rect x="11" y="6" width="4" height="4" rx="0.5"/>
                <rect x="1" y="11" width="4" height="4" rx="0.5"/>
                <rect x="6" y="11" width="4" height="4" rx="0.5"/>
                <rect x="11" y="11" width="4" height="4" rx="0.5"/>
              </svg>
            </LayoutBtn>
            <LayoutBtn active={layout === "big"} title="Big thumbnails" onClick={() => changeLayout("big")}>
              {/* 2x2 large grid */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1" width="6.5" height="6.5" rx="0.5"/>
                <rect x="8.5" y="1" width="6.5" height="6.5" rx="0.5"/>
                <rect x="1" y="8.5" width="6.5" height="6.5" rx="0.5"/>
                <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="0.5"/>
              </svg>
            </LayoutBtn>
            <LayoutBtn active={layout === "detailed"} title="Detailed list" onClick={() => changeLayout("detailed")}>
              {/* list rows with thumbnail */}
              <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <rect x="1" y="1.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="2" width="9.5" height="1.2" rx="0.6"/>
                <rect x="5.5" y="4" width="6.5" height="1" rx="0.5"/>
                <rect x="1" y="6.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="7" width="9.5" height="1.2" rx="0.6"/>
                <rect x="5.5" y="9" width="6.5" height="1" rx="0.5"/>
                <rect x="1" y="11.5" width="3.5" height="3.5" rx="0.5"/>
                <rect x="5.5" y="12" width="9.5" height="1.2" rx="0.6"/>
                <rect x="5.5" y="14" width="6.5" height="1" rx="0.5"/>
              </svg>
            </LayoutBtn>
          </div>
        </div>
        <div className="p-4">
          {isLoading ? (
            <div className="text-zinc-500">Loading…</div>
          ) : items.length === 0 ? (
            <div className="text-zinc-500">Nothing here yet. Click <b>+ Add</b>.</div>
          ) : (
            <div className={gridClass}>
              {items.map(it => (
                <ItemCard
                  key={it.id}
                  item={it}
                  layout={layout}
                  onDelete={(id) => del.mutate(id)}
                  onToggleWatched={(it) => toggleWatched.mutate(it)}
                  onEditTags={(it, tags) => editTags.mutate({ id: it.id, tags })}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
