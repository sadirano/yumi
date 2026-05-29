import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import ItemCard from "../components/ItemCard";

export default function CollectionDetail() {
  const { id } = useParams();
  const cid = Number(id);
  const qc = useQueryClient();
  const { data: c } = useQuery({ queryKey: ["collection", cid], queryFn: () => api.getCollection(cid) });

  const remove = useMutation({
    mutationFn: (itemId: number) => api.removeFromCollection(cid, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collection", cid] }),
  });

  const move = useMutation({
    mutationFn: ({ item_id, after_id }: { item_id: number; after_id: number | null }) =>
      api.moveInCollection(cid, item_id, after_id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["collection", cid] }),
  });

  const del = useMutation({
    mutationFn: () => api.deleteCollection(cid),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["collections"] }); history.back(); },
  });

  if (!c) return <div className="p-6 text-zinc-500">Loading…</div>;

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link to="/collections" className="text-xs text-zinc-400 hover:text-zinc-100">← collections</Link>
          <h1 className="text-xl font-semibold mt-1">{c.name}</h1>
          <p className="text-xs text-zinc-500">{c.items.length} items</p>
        </div>
        <button onClick={() => del.mutate()} className="px-3 py-1.5 text-sm rounded bg-red-700 hover:bg-red-600">
          Delete collection
        </button>
      </div>
      {c.items.length === 0 ? (
        <p className="text-zinc-500">No items yet. Add from any item's detail view (coming soon: drag from library).</p>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {c.items.map((it, i) => (
            <div key={it.id} className="relative">
              <ItemCard item={it} onDelete={() => remove.mutate(it.id)} />
              <div className="absolute -bottom-1 left-1 right-1 flex gap-1 justify-center opacity-0 hover:opacity-100">
                <button
                  className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded"
                  disabled={i === 0}
                  onClick={() => move.mutate({ item_id: it.id, after_id: i >= 2 ? c.items[i - 2].id : 0 })}
                  title="move up"
                >↑</button>
                <button
                  className="text-[10px] bg-zinc-800 px-1.5 py-0.5 rounded"
                  disabled={i === c.items.length - 1}
                  onClick={() => move.mutate({ item_id: it.id, after_id: c.items[i + 1].id })}
                  title="move down"
                >↓</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
