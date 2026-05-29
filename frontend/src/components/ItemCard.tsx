import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fmtDuration, Item, itemLink } from "../api/client";
import TagInput, { renderTagName } from "./TagInput";

export type Layout = "normal" | "big" | "detailed";

interface Props {
  item: Item;
  layout?: Layout;
  onDelete?: (id: number) => void;
  onToggleWatched?: (item: Item) => void;
  onEditTags?: (item: Item, tags: string[]) => void;
}

const statusBadge: Record<string, string> = {
  "to-watch": "bg-blue-600/30 text-blue-200",
  "watching": "bg-amber-500/30 text-amber-200",
  "watched":  "bg-emerald-600/30 text-emerald-200",
  "archived": "bg-zinc-700 text-zinc-300",
};

const nextStatus: Record<string, string> = {
  "to-watch": "watching",
  "watching": "watched",
  "watched":  "to-watch",
  "archived": "to-watch",
};

const statusIcon: Record<string, string> = {
  "to-watch": "▶",
  "watching": "✓",
  "watched":  "↺",
  "archived": "↺",
};

/** Popover for editing an item's tags inline from the grid. Keeps edits local
 *  and commits once (on Done or click-outside) so we don't spam PATCH calls. */
function TagEditorPopover({ item, onSave, onClose, className }: {
  item: Item;
  onSave: (tags: string[]) => void;
  onClose: () => void;
  className?: string;
}) {
  const [tags, setTags] = useState<string[]>(() => item.tags.map(t => t.name));
  const ref = useRef<HTMLDivElement>(null);

  function commit() {
    const orig = JSON.stringify(item.tags.map(t => t.name).sort());
    const next = JSON.stringify([...tags].sort());
    if (orig !== next) onSave(tags);
    onClose();
  }

  // Save & close on outside click. Re-bound on every `tags` change so the
  // handler closes over the latest selection.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) commit();
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  });

  return (
    <div
      ref={ref}
      className={`absolute z-30 w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-2 ${className ?? ""}`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs text-zinc-400">Edit tags</span>
        <button type="button" onClick={commit} className="text-xs px-2 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white">
          Done
        </button>
      </div>
      <TagInput value={tags} onChange={setTags} />
    </div>
  );
}

export default function ItemCard({ item, layout = "normal", onDelete, onToggleWatched, onEditTags }: Props) {
  const [editingTags, setEditingTags] = useState(false);
  const link = itemLink(item);

  // Shared hover-button cluster. `variant` tunes colours to the layout's backdrop.
  function ActionButtons({ variant }: { variant: "overlay" | "panel" }) {
    const base = variant === "overlay"
      ? "text-xs px-1.5 py-0.5 rounded bg-black/80"
      : "text-xs px-1.5 py-0.5 rounded bg-zinc-800";
    return (
      <>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className={`${base} hover:bg-blue-700 text-center`}
            title="Open link"
          >
            ↗
          </a>
        )}
        {onEditTags && (
          <button
            type="button"
            // Open-only + stopPropagation so the popover's click-outside handler
            // doesn't fight this button (toggling would close-then-reopen). Close
            // via Done or by clicking elsewhere — both save.
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setEditingTags(true)}
            className={`${base} ${editingTags ? "bg-blue-700" : "hover:bg-blue-700"}`}
            title="Edit tags"
          >
            🏷
          </button>
        )}
        {onToggleWatched && (
          <button
            type="button"
            onClick={() => onToggleWatched(item)}
            className={`${base} hover:bg-emerald-700`}
            title="Toggle watched"
          >
            {statusIcon[item.status] ?? "✓"}
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={() => onDelete(item.id)}
            className={`${base} hover:bg-red-700`}
            title="Move to trash"
          >
            🗑
          </button>
        )}
      </>
    );
  }

  const tagEditor = editingTags && onEditTags && (
    <TagEditorPopover
      item={item}
      onSave={(tags) => onEditTags(item, tags)}
      onClose={() => setEditingTags(false)}
      className="top-full right-1 mt-1"
    />
  );

  if (layout === "detailed") {
    return (
      <div className="group relative">
        <div className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition flex">
          <Link to={`/items/${item.id}`} className="flex flex-1 min-w-0">
            <div className="relative w-44 flex-shrink-0 bg-zinc-800 self-stretch">
              {item.thumbnail_url ? (
                <img src={item.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs uppercase min-h-[6rem]">
                  {item.kind}
                </div>
              )}
              {item.duration_sec ? (
                <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-xs bg-black/80 rounded">
                  {fmtDuration(item.duration_sec)}
                </span>
              ) : null}
            </div>
            <div className="flex-1 min-w-0 p-3 flex flex-col gap-1.5">
              <div className="flex items-start gap-2 flex-wrap">
                <span className={`flex-shrink-0 px-1.5 py-0.5 text-[10px] uppercase rounded ${statusBadge[item.status]}`}>
                  {item.status}
                </span>
                <span className="text-sm font-medium line-clamp-2 group-hover:text-white">{item.title || "(untitled)"}</span>
              </div>
              {item.channel && <div className="text-xs text-zinc-400 line-clamp-1">{item.channel}</div>}
              {item.tags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {item.tags.map(t => (
                    <span key={t.id} className="text-[10px] bg-zinc-800 text-zinc-300 rounded px-1.5 py-0.5">{renderTagName(t.name)}</span>
                  ))}
                </div>
              )}
            </div>
          </Link>
          <div className="flex-shrink-0 px-2 flex flex-col gap-1 justify-center opacity-0 group-hover:opacity-100 transition">
            <ActionButtons variant="panel" />
          </div>
        </div>
        {tagEditor}
      </div>
    );
  }

  const tags = item.tags.slice(0, 3);
  const more = item.tags.length - tags.length;

  return (
    <div className="group relative">
      <div className="bg-zinc-900 rounded-lg overflow-hidden border border-zinc-800 hover:border-zinc-600 transition">
        <Link to={`/items/${item.id}`} className="block">
          <div className="relative aspect-video bg-zinc-800">
            {item.thumbnail_url ? (
              <img src={item.thumbnail_url} alt="" loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-zinc-600 text-xs uppercase">
                {item.kind}
              </div>
            )}
            {item.duration_sec ? (
              <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-xs bg-black/80 rounded">
                {fmtDuration(item.duration_sec)}
              </span>
            ) : null}
            <span className={`absolute top-1 left-1 px-1.5 py-0.5 text-[10px] uppercase rounded ${statusBadge[item.status]}`}>
              {item.status}
            </span>
            <div className="absolute bottom-1 left-1 flex flex-wrap gap-1 max-w-[80%]">
              {tags.map(t => (
                <span key={t.id} className="text-[10px] bg-black/70 text-zinc-100 rounded px-1.5 py-0.5">{renderTagName(t.name)}</span>
              ))}
              {more > 0 && <span className="text-[10px] bg-black/70 text-zinc-300 rounded px-1.5 py-0.5">+{more}</span>}
            </div>
          </div>
          <div className="p-2">
            <div className="text-sm font-medium line-clamp-2 group-hover:text-white">{item.title || "(untitled)"}</div>
            {item.channel && <div className="text-xs text-zinc-400 mt-1 line-clamp-1">{item.channel}</div>}
          </div>
        </Link>
      </div>
      <div className="absolute top-1 right-1 hidden group-hover:flex flex-col gap-1">
        <ActionButtons variant="overlay" />
      </div>
      {tagEditor}
    </div>
  );
}
