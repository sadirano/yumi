import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, Space } from "../api/client";
import TagInput from "./TagInput";

interface Props {
  space?: Space;
  onSave: (name: string, namespaces: string[], tags: string[]) => void;
  onDelete?: () => void;
  onClose: () => void;
}

export default function SpaceDialog({ space, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(space?.name ?? "");
  const [selectedNs, setSelectedNs] = useState<Set<string>>(new Set(space?.namespaces ?? []));
  const [requiredTags, setRequiredTags] = useState<string[]>(space?.tags ?? []);
  const [nsInput, setNsInput] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { data: allTags = [] } = useQuery({
    queryKey: ["tags"],
    queryFn: () => api.listTags(),
    staleTime: 30_000,
  });

  const existingNamespaces = useMemo(() => {
    const ns = new Set<string>();
    for (const t of allTags) {
      const colon = t.name.indexOf(":");
      if (colon > 0) ns.add(t.name.slice(0, colon));
    }
    return Array.from(ns).sort();
  }, [allTags]);

  function toggleNs(ns: string) {
    setSelectedNs(prev => {
      const next = new Set(prev);
      if (next.has(ns)) next.delete(ns); else next.add(ns);
      return next;
    });
  }

  function addCustomNs() {
    const ns = nsInput.trim().toLowerCase().replace(/\s+/g, "-");
    if (!ns) return;
    setSelectedNs(prev => new Set([...prev, ns]));
    setNsInput("");
  }

  function handleSave() {
    if (!name.trim()) return;
    onSave(name.trim(), Array.from(selectedNs), requiredTags);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">{space ? "Edit space" : "New space"}</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 text-lg leading-none">×</button>
        </div>

        {/* Name */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSave()}
            placeholder="Anime, Music, Novel…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
        </div>

        {/* Required tags */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Required tags</label>
          <p className="text-[10px] text-zinc-500 mb-2">Items must have ALL of these tags to appear in this space. Use this to pin the space to a specific type, e.g. <span className="font-mono">type:anime</span>.</p>
          <TagInput value={requiredTags} onChange={setRequiredTags} placeholder="type:anime, media:series…" />
        </div>

        {/* Namespaces */}
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">Namespaces</label>
          <p className="text-[10px] text-zinc-500 mb-2">Items with tags in these namespaces appear in this space (if required tags also match). The sidebar tag browser scopes to these namespaces.</p>

          {existingNamespaces.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {existingNamespaces.map(ns => (
                <button
                  key={ns}
                  onClick={() => toggleNs(ns)}
                  className={`px-2.5 py-1 rounded text-xs transition ${
                    selectedNs.has(ns)
                      ? "bg-blue-600 text-white"
                      : "bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
                  }`}
                >
                  {ns}:
                </button>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              value={nsInput}
              onChange={e => setNsInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && addCustomNs()}
              placeholder="add namespace…"
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2.5 py-1.5 text-xs outline-none focus:border-zinc-500"
            />
            <button onClick={addCustomNs} className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded text-xs">
              Add
            </button>
          </div>

          {selectedNs.size > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {Array.from(selectedNs).sort().map(ns => (
                <span key={ns} className="inline-flex items-center gap-1 bg-blue-600/20 text-blue-300 border border-blue-700/40 rounded px-2 py-0.5 text-xs">
                  {ns}:
                  <button onClick={() => toggleNs(ns)} className="text-blue-400 hover:text-white">×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between pt-1">
          {onDelete ? (
            confirmDelete ? (
              <div className="flex gap-2 items-center">
                <span className="text-xs text-zinc-400">Delete this space?</span>
                <button onClick={onDelete} className="text-xs px-2 py-1 bg-red-700 hover:bg-red-600 rounded">Yes, delete</button>
                <button onClick={() => setConfirmDelete(false)} className="text-xs px-2 py-1 bg-zinc-700 hover:bg-zinc-600 rounded">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setConfirmDelete(true)} className="text-xs text-zinc-500 hover:text-red-400">
                Delete space
              </button>
            )
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded">Cancel</button>
            <button
              onClick={handleSave}
              disabled={!name.trim()}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
