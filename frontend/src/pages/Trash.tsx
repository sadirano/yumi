import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import ItemCard from "../components/ItemCard";

export default function Trash() {
  const qc = useQueryClient();
  const { data: items = [] } = useQuery({ queryKey: ["trash"], queryFn: api.listTrash });

  const restore = useMutation({
    mutationFn: (id: number) => api.restoreItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["trash"] });
      qc.invalidateQueries({ queryKey: ["items"] });
    },
  });
  const purge = useMutation({
    mutationFn: (id: number) => api.purgeItem(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["trash"] }),
  });

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <h1 className="text-xl font-semibold mb-3">Trash</h1>
      {items.length === 0 ? (
        <p className="text-zinc-500">Empty.</p>
      ) : (
        <div className="grid gap-3 grid-cols-[repeat(auto-fill,minmax(220px,1fr))]">
          {items.map(it => (
            <div key={it.id} className="relative">
              <ItemCard item={it} />
              <div className="absolute inset-x-1 -bottom-1 flex gap-1 justify-center">
                <button onClick={() => restore.mutate(it.id)} className="text-[10px] bg-emerald-700 px-2 py-0.5 rounded">restore</button>
                <button
                  onClick={() => { if (confirm("Purge permanently?")) purge.mutate(it.id); }}
                  className="text-[10px] bg-red-700 px-2 py-0.5 rounded"
                >purge</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
