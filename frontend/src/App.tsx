import { useState } from "react";
import { Link, NavLink, Route, Routes, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Library from "./pages/Library";
import ItemDetail from "./pages/ItemDetail";
import Collections from "./pages/Collections";
import CollectionDetail from "./pages/CollectionDetail";
import Trash from "./pages/Trash";
import AddItemDialog from "./components/AddItemDialog";
import SpaceDialog from "./components/SpaceDialog";
import { api, Space } from "./api/client";

const navClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded text-sm ${isActive ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`;

function SpaceNavItems({ spaces }: { spaces: Space[] }) {
  const [sp] = useSearchParams();
  const activeSpaceId = sp.get("space") ? Number(sp.get("space")) : null;
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Space | null>(null);

  const update = useMutation({
    mutationFn: ({ id, name, namespaces, tags }: { id: number; name: string; namespaces: string[]; tags: string[] }) =>
      api.updateSpace(id, { name, namespaces, tags }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  const del = useMutation({
    mutationFn: (id: number) => api.deleteSpace(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["spaces"] }); setEditing(null); },
  });

  return (
    <>
      {spaces.map(space => (
        <span key={space.id} className="group/space relative inline-flex items-center">
          <Link
            to={`/?space=${space.id}`}
            className={`px-3 py-1.5 rounded-l text-sm pr-1.5 ${activeSpaceId === space.id ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-100"}`}
          >
            {space.name}
          </Link>
          <button
            onClick={() => setEditing(space)}
            className={`px-1 py-1.5 rounded-r text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/space:opacity-100 transition-opacity text-xs ${activeSpaceId === space.id ? "bg-zinc-800" : "hover:bg-zinc-800"}`}
            title="Edit space"
          >
            ⚙
          </button>
        </span>
      ))}
      {editing && (
        <SpaceDialog
          space={editing}
          onSave={(name, namespaces, tags) => update.mutate({ id: editing.id, name, namespaces, tags })}
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
    mutationFn: ({ name, namespaces, tags }: { name: string; namespaces: string[]; tags: string[] }) =>
      api.createSpace(name, namespaces, tags),
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
          <NavLink to="/collections" className={navClass}>Collections</NavLink>
          <NavLink to="/trash" className={navClass}>Trash</NavLink>
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
          <Route path="/collections" element={<Collections />} />
          <Route path="/collections/:id" element={<CollectionDetail />} />
          <Route path="/trash" element={<Trash />} />
        </Routes>
      </main>
      {adding && <AddItemDialog onClose={() => setAdding(false)} />}
      {creatingSpace && (
        <SpaceDialog
          onSave={(name, namespaces, tags) => createSpace.mutate({ name, namespaces, tags })}
          onClose={() => setCreatingSpace(false)}
        />
      )}
    </div>
  );
}
