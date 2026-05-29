import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

export default function Collections() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const { data: cols = [] } = useQuery({ queryKey: ["collections"], queryFn: api.listCollections });
  const create = useMutation({
    mutationFn: (n: string) => api.createCollection(n),
    onSuccess: () => { setName(""); qc.invalidateQueries({ queryKey: ["collections"] }); },
  });

  return (
    <div className="p-4 max-w-2xl mx-auto">
      <h1 className="text-xl font-semibold mb-4">Collections</h1>
      <div className="flex gap-2 mb-6">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="New collection name…"
          className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
        />
        <button
          onClick={() => name.trim() && create.mutate(name.trim())}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm"
        >
          Create
        </button>
      </div>
      <ul className="space-y-1">
        {cols.map(c => (
          <li key={c.id}>
            <Link
              to={`/collections/${c.id}`}
              className="block px-3 py-2 rounded bg-zinc-900 border border-zinc-800 hover:border-zinc-600 flex justify-between"
            >
              <span>{c.name}</span>
              <span className="text-xs text-zinc-500">{c.item_count} items</span>
            </Link>
          </li>
        ))}
        {cols.length === 0 && <li className="text-zinc-500">No collections yet.</li>}
      </ul>
    </div>
  );
}
