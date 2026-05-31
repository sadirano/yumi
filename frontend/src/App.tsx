import { useState, useEffect, useRef } from "react";
import { Link, NavLink, Route, Routes, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Library from "./pages/Library";
import ItemDetail from "./pages/ItemDetail";
import Trash from "./pages/Trash";
import AddItemDialog from "./components/AddItemDialog";
import SpaceDialog from "./components/SpaceDialog";
import { api, Space } from "./api/client";
import { getSerializedTags, setSerializedTags } from "./lib/serialized";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded text-sm ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`;

// Edits the tags that mark content as serialized (gets an episode/chapter
// counter). Persists locally; reloads so every card/detail re-reads the rule.
function CounterTagsDialog({ onClose }: { onClose: () => void }) {
  const [value, setValue] = useState(() => getSerializedTags().join(", "));
  function save() {
    setSerializedTags(value.split(","));
    onClose();
    window.location.reload();
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-4 w-96" onClick={e => e.stopPropagation()}>
        <h2 className="text-sm font-medium mb-1">Counter tags</h2>
        <p className="text-xs text-zinc-500 mb-3">
          Items carrying any of these tags get an episode/chapter counter. Comma-separated.
        </p>
        <input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") onClose(); }}
          placeholder="source:anime, source:manga"
          className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-sm font-mono outline-none focus:border-zinc-500"
        />
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-100">Cancel</button>
          <button onClick={save} className="px-3 py-1.5 text-sm rounded bg-blue-600 hover:bg-blue-500">Save</button>
        </div>
      </div>
    </div>
  );
}

// Right-aligned "⋯" menu for secondary, rarely-used destinations (Trash, settings)
// so they don't clutter the main nav. Click-outside closes, like SpaceMenu below.
function OverflowMenu() {
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <>
      <div ref={ref} className="relative">
        <button
          onClick={() => setOpen(o => !o)}
          className={`px-2 py-1.5 rounded text-sm ${open ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`}
          title="More"
          aria-label="More"
        >
          ⋯
        </button>
        {open && (
          <div className="absolute top-full right-0 mt-1 z-40 min-w-[10rem] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 flex flex-col">
            <NavLink
              to="/trash"
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `px-3 py-1.5 text-sm ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"}`
              }
            >
              Trash
            </NavLink>
            <button
              onClick={() => { setOpen(false); setSettingsOpen(true); }}
              className="px-3 py-1.5 text-sm text-left text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            >
              Counter tags…
            </button>
          </div>
        )}
      </div>
      {settingsOpen && <CounterTagsDialog onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

// A space whose name contains a colon (e.g. "Work: Alpha") is collapsed into a
// dropdown menu named by the part before the first colon ("Work"); the part
// after becomes its label inside the menu. Spaces with no colon stay top-level.
type NavEntry =
  | { kind: "space"; space: Space }
  | { kind: "group"; prefix: string; spaces: Space[] };

function buildNavEntries(spaces: Space[]): NavEntry[] {
  const entries: NavEntry[] = [];
  const groupIndex = new Map<string, number>();
  for (const space of spaces) {
    const colon = space.name.indexOf(":");
    if (colon > 0) {
      const prefix = space.name.slice(0, colon).trim();
      const existing = groupIndex.get(prefix);
      if (existing === undefined) {
        groupIndex.set(prefix, entries.length);
        entries.push({ kind: "group", prefix, spaces: [space] });
      } else {
        (entries[existing] as { spaces: Space[] }).spaces.push(space);
      }
    } else {
      entries.push({ kind: "space", space });
    }
  }
  return entries;
}

// Label shown inside a group menu: the part after the first colon, trimmed.
// Falls back to the full name if there's nothing after the colon.
function menuLabel(name: string): string {
  const colon = name.indexOf(":");
  const rest = colon > 0 ? name.slice(colon + 1).trim() : "";
  return rest || name;
}

function SpaceLink({
  space, label, activeSpaceId, onEdit, className,
}: {
  space: Space;
  label: string;
  activeSpaceId: number | null;
  onEdit: (s: Space) => void;
  className?: string;
}) {
  const active = activeSpaceId === space.id;
  return (
    <span className={`group/space relative inline-flex items-center ${className ?? ""}`}>
      <Link
        to={`/?space=${space.id}`}
        className={`px-3 py-1.5 rounded-l text-sm pr-1.5 ${active ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`}
      >
        {label}
      </Link>
      <button
        onClick={() => onEdit(space)}
        className={`px-1 py-1.5 rounded-r text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/space:opacity-100 transition-opacity text-xs ${active ? "bg-zinc-800" : "hover:bg-zinc-800"}`}
        title="Edit space"
      >
        ⚙
      </button>
    </span>
  );
}

function SpaceMenu({
  prefix, spaces, activeSpaceId, onEdit,
}: {
  prefix: string;
  spaces: Space[];
  activeSpaceId: number | null;
  onEdit: (s: Space) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeChild = spaces.find(s => s.id === activeSpaceId);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex items-center">
      <button
        onClick={() => setOpen(o => !o)}
        className={`px-3 py-1.5 rounded text-sm inline-flex items-center gap-1 ${
          activeChild ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
        }`}
        title={`${prefix} spaces`}
      >
        {activeChild ? `${prefix}: ${menuLabel(activeChild.name)}` : prefix}
        <span className="text-[10px] text-zinc-500">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-40 min-w-[12rem] bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl py-1 flex flex-col">
          {spaces.map(space => (
            <SpaceLink
              key={space.id}
              space={space}
              label={menuLabel(space.name)}
              activeSpaceId={activeSpaceId}
              onEdit={s => { setOpen(false); onEdit(s); }}
              className="px-1"
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SpaceNavItems({ spaces }: { spaces: Space[] }) {
  const [sp] = useSearchParams();
  const activeSpaceId = sp.get("space") ? Number(sp.get("space")) : null;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Space | null>(null);

  const update = useMutation({
    mutationFn: ({ id, name, namespaces, tags, labels }: { id: number; name: string; namespaces: string[]; tags: string[]; labels: Record<string, string> | null }) =>
      api.updateSpace(id, { name, namespaces, tags, labels }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteSpace(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const entries = buildNavEntries(spaces);

  return (
    <>
      {entries.map(entry =>
        entry.kind === "space" ? (
          <SpaceLink
            key={entry.space.id}
            space={entry.space}
            label={entry.space.name}
            activeSpaceId={activeSpaceId}
            onEdit={setEditing}
          />
        ) : (
          <SpaceMenu
            key={`grp:${entry.prefix}`}
            prefix={entry.prefix}
            spaces={entry.spaces}
            activeSpaceId={activeSpaceId}
            onEdit={setEditing}
          />
        )
      )}
      {editing && (
        <SpaceDialog
          space={editing}
          onSave={(name, namespaces, tags, labels) => update.mutate({ id: editing.id, name, namespaces, tags, labels })}
          onDelete={() => del.mutate(editing.id)}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}

export default function App() {
  const [adding, setAdding] = useState(false);
  const [creatingSpace, setCreatingSpace] = useState(false);
  const qc = useQueryClient();

  const { data: spaces = [] } = useQuery({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });

  const createSpace = useMutation({
    mutationFn: ({ name, namespaces, tags, labels }: { name: string; namespaces: string[]; tags: string[]; labels: Record<string, string> | null }) =>
      api.createSpace(name, namespaces, tags, labels),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setCreatingSpace(false); },
  });

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-zinc-800 px-4 py-2 flex items-center gap-2 flex-wrap">
        <span className="font-semibold text-zinc-100">yumi</span>
        <nav className="flex gap-1 ml-4 flex-wrap items-center">
          <NavLink to="/" end className={navClass}>Library</NavLink>
          <SpaceNavItems spaces={spaces} />
          <button
            onClick={() => setCreatingSpace(true)}
            className="px-2 py-1.5 rounded text-sm text-zinc-600 hover:text-zinc-300 hover:bg-zinc-800 transition"
            title="New space"
          >
            +
          </button>
        </nav>
        <div className="flex gap-1 ml-auto items-center">
          <OverflowMenu />
          <button
            onClick={() => setAdding(true)}
            className="ml-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium"
          >
            + Add
          </button>
        </div>
      </header>
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/items/:id" element={<ItemDetail />} />
          <Route path="/trash" element={<Trash />} />
        </Routes>
      </main>
      {adding && <AddItemDialog onClose={() => setAdding(false)} />}
      {creatingSpace && (
        <SpaceDialog
          onSave={(name, namespaces, tags, labels) => createSpace.mutate({ name, namespaces, tags, labels })}
          onClose={() => setCreatingSpace(false)}
        />
      )}
    </div>
  );
}
