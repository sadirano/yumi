import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import { api, ItemStatus, Revision } from "../api/client";
import { isSerialized } from "../lib/serialized";
import TagInput from "../components/TagInput";

type Layout = "split" | "notes";

export default function ItemDetail() {
  const { id } = useParams();
  const itemId = Number(id);
  const qc = useQueryClient();
  const nav = useNavigate();

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => api.getItem(itemId),
    enabled: !!itemId,
  });

  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<ItemStatus>("to-watch");
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [preview, setPreview] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [layout, setLayout] = useState<Layout>("split");
  const ready = useRef(false);

  const [thumbEdit, setThumbEdit] = useState(false);
  const [thumbInput, setThumbInput] = useState("");

  const [copyOpen, setCopyOpen] = useState(false);
  const [copyQuery, setCopyQuery] = useState("");
  const [copyResults, setCopyResults] = useState<Awaited<ReturnType<typeof api.listItems>>>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [revisions, setRevisions] = useState<Revision[]>([]);

  useEffect(() => {
    if (!copyQuery.trim()) { setCopyResults([]); return; }
    const t = setTimeout(async () => {
      const results = await api.listItems({ q: copyQuery.trim(), limit: 6 });
      setCopyResults(results.filter(r => r.id !== itemId));
    }, 150);
    return () => clearTimeout(t);
  }, [copyQuery, itemId]);

  useEffect(() => {
    if (!item) return;
    ready.current = false;
    setNotes(item.notes_md);
    setTitle(item.title);
    setTags(item.tags.map(t => t.name));
    setSource(item.source);
    setStatus(item.status);
    setProgress(item.progress);
    setTotal(item.total);
    const t = setTimeout(() => { ready.current = true; }, 0);
    return () => clearTimeout(t);
  }, [item?.id]);

  const save = useMutation({
    mutationFn: (data: { title: string; notes_md: string; tags: string[]; source: string; status: ItemStatus; progress: number; total: number | null }) =>
      api.patchItem(itemId, data),
    onMutate: () => setSaveStatus("saving"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["tags"] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
  });

  useEffect(() => {
    if (!ready.current) return;
    const t = setTimeout(() => {
      save.mutate({ title, notes_md: notes, tags, source, status, progress, total });
    }, 800);
    return () => clearTimeout(t);
  }, [title, notes, tags, source, status, progress, total]);

  const del = useMutation({
    mutationFn: () => api.deleteItem(itemId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["items"] }); nav("/"); },
  });

  const restore = useMutation({
    mutationFn: (revId: number) => api.restoreRevision(itemId, revId),
    onSuccess: (updated) => {
      ready.current = false;
      setTitle(updated.title);
      setNotes(updated.notes_md);
      setTags(updated.tags.map(t => t.name));
      setSource(updated.source);
      setStatus(updated.status);
      setProgress(updated.progress);
      setTotal(updated.total);
      setTimeout(() => { ready.current = true; }, 0);
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setHistoryOpen(false);
    },
  });

  async function openHistory() {
    setMenuOpen(false);
    const revs = await api.listRevisions(itemId);
    setRevisions(revs);
    setHistoryOpen(true);
  }

  function fmtTime(iso: string) {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const refresh = useMutation({
    mutationFn: () => api.refreshItem(itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["item", itemId] }),
  });

  const patchThumb = useMutation({
    mutationFn: (url: string) => api.patchItem(itemId, { thumbnail_url: url || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setThumbEdit(false);
    },
  });

  if (isLoading || !item) return <div className="p-6 text-zinc-500">Loading...</div>;

  const media = (
    <div className="w-full h-full bg-zinc-900 rounded overflow-hidden flex items-center justify-center relative group/thumb">
      {thumbEdit ? (
        <div className="absolute inset-0 bg-zinc-900/95 flex flex-col items-center justify-center p-4 gap-3 z-10">
          {thumbInput && (
            <img src={thumbInput} alt="preview" className="w-full max-h-32 object-contain rounded" onError={e => (e.currentTarget.style.display = "none")} />
          )}
          <input
            autoFocus
            value={thumbInput}
            onChange={e => setThumbInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") patchThumb.mutate(thumbInput.trim());
              if (e.key === "Escape") setThumbEdit(false);
            }}
            placeholder="Paste image URL…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
          <div className="flex gap-2">
            <button
              onClick={() => patchThumb.mutate(thumbInput.trim())}
              disabled={patchThumb.isPending}
              className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 rounded disabled:opacity-50"
            >
              {patchThumb.isPending ? "Saving…" : "Save"}
            </button>
            <button onClick={() => setThumbEdit(false)} className="px-3 py-1.5 text-sm bg-zinc-700 hover:bg-zinc-600 rounded">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {item.kind === "youtube" && item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="relative w-full h-full block group">
              {item.thumbnail_url
                ? <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-contain" />
                : <div className="w-full h-full bg-zinc-800" />
              }
              <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="text-white text-sm font-medium">Watch on YouTube</span>
              </div>
            </a>
          ) : item.kind === "file" && item.file_path ? (
            <video src={`file:///${item.file_path}`} controls className="w-full h-full" />
          ) : item.thumbnail_url ? (
            <img src={item.thumbnail_url} alt={item.title} className="w-full h-full object-contain" />
          ) : item.url ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="text-blue-400 underline">Open source</a>
          ) : (
            <span className="text-zinc-500 text-sm">No preview</span>
          )}
          <button
            onClick={() => { setThumbInput(item.thumbnail_url || ""); setThumbEdit(true); }}
            className="absolute bottom-2 right-2 px-2 py-1 text-xs bg-black/70 hover:bg-black/90 rounded opacity-0 group-hover/thumb:opacity-100 transition-opacity"
          >
            Change image
          </button>
        </>
      )}
    </div>
  );

  const meta = (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      {item.channel && <span>{item.channel}</span>}
      {item.published_at && <span>- {item.published_at}</span>}
      {item.url && <a href={item.url} target="_blank" rel="noreferrer" className="text-blue-400 hover:underline ml-auto">open</a>}
    </div>
  );

  const notesPanel = (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
        <span>Notes (markdown)</span>
        <button onClick={() => setPreview(p => !p)} className="hover:text-zinc-100">{preview ? "edit" : "preview"}</button>
      </div>
      {preview ? (
        <div className="prose prose-invert prose-sm max-w-none flex-1 overflow-auto bg-zinc-900 rounded p-3 border border-zinc-800">
          <ReactMarkdown>{notes || "_no notes_"}</ReactMarkdown>
        </div>
      ) : (
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          className="flex-1 resize-none bg-zinc-900 rounded p-3 border border-zinc-800 font-mono text-sm"
          placeholder="What did you think? Key takeaways. Timestamps. Anything searchable."
        />
      )}
    </div>
  );

  const fields = (
    <>
      <input
        value={title}
        onChange={e => setTitle(e.target.value)}
        className="bg-transparent text-2xl font-semibold outline-none border-b border-transparent focus:border-zinc-700"
      />
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-zinc-400">tags</label>
          <button
            type="button"
            onClick={() => { setCopyOpen(o => !o); setCopyQuery(""); setCopyResults([]); }}
            className="text-xs text-zinc-500 hover:text-zinc-300"
          >
            copy from...
          </button>
        </div>
        {copyOpen && (
          <div className="relative mb-1.5">
            <input
              autoFocus
              value={copyQuery}
              onChange={e => setCopyQuery(e.target.value)}
              placeholder="search by title..."
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm outline-none"
            />
            {copyResults.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full bg-zinc-900 border border-zinc-800 rounded shadow-lg">
                {copyResults.map(r => (
                  <li
                    key={r.id}
                    className="px-2 py-1.5 text-sm hover:bg-zinc-800 cursor-pointer"
                    onMouseDown={() => {
                      setTags(prev => [...new Set([...prev, ...r.tags.map(t => t.name)])]);
                      setCopyOpen(false);
                      setCopyQuery("");
                      setCopyResults([]);
                    }}
                  >
                    <span className="text-zinc-200 truncate block">{r.title}</span>
                    <span className="text-zinc-500 text-xs">{r.tags.map(t => t.name).join(", ")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <TagInput value={tags} onChange={setTags} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">status</label>
          <select value={status} onChange={e => setStatus(e.target.value as ItemStatus)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm">
            <option value="to-watch">to-watch</option>
            <option value="watching">watching</option>
            <option value="watched">watched</option>
            <option value="archived">archived</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">source</label>
          <input value={source} onChange={e => setSource(e.target.value)} className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm" />
        </div>
      </div>
      {isSerialized(tags) && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">progress</label>
            <input
              type="number"
              min={0}
              value={progress}
              onChange={e => setProgress(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-400 mb-1 block">total <span className="text-zinc-600">(blank = ongoing)</span></label>
            <input
              type="number"
              min={0}
              value={total ?? ""}
              onChange={e => {
                const v = e.target.value.trim();
                setTotal(v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
              }}
              placeholder="?"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          </div>
        </div>
      )}
      {item.needs_enrichment && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2">
          Enrichment failed. Try "Re-fetch metadata" in the ... menu.
        </div>
      )}
    </>
  );

  const topBar = (
    <div className="flex items-center gap-2 shrink-0">
      <Link to="/" className="text-xs text-zinc-400 hover:text-zinc-100">back</Link>
      <span className={`ml-2 text-xs transition-opacity duration-500 ${saveStatus === "idle" ? "opacity-0" : "opacity-100"} ${saveStatus === "saved" ? "text-zinc-400" : "text-zinc-500"}`}>
        {saveStatus === "saving" ? "Saving..." : "Saved"}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={() => setLayout(l => l === "split" ? "notes" : "split")}
          className="text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800"
          title={layout === "split" ? "Focus on notes" : "Show thumbnail"}
        >
          {layout === "split" ? "notes view" : "split view"}
        </button>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
            className="px-2 py-1 text-zinc-400 hover:text-zinc-100 rounded hover:bg-zinc-800 text-base leading-none"
          >
            ...
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded shadow-lg z-20 min-w-44">
              <button
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800"
                onMouseDown={openHistory}
              >
                History
              </button>
              {item.url && (
                <button
                  className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 disabled:opacity-50"
                  onMouseDown={() => { refresh.mutate(); setMenuOpen(false); }}
                  disabled={refresh.isPending}
                >
                  {refresh.isPending ? "Refreshing..." : "Re-fetch metadata"}
                </button>
              )}
              <button
                className="w-full text-left px-3 py-2 text-sm text-red-400 hover:bg-zinc-800 disabled:opacity-50"
                onMouseDown={() => del.mutate()}
                disabled={del.isPending}
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const historyPanel = historyOpen && (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={() => setHistoryOpen(false)}>
      <div className="w-80 bg-zinc-900 border-l border-zinc-800 h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
          <span className="text-sm font-medium">History</span>
          <button onClick={() => setHistoryOpen(false)} className="text-zinc-500 hover:text-zinc-200">x</button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {revisions.length === 0 ? (
            <p className="text-zinc-500 text-sm p-4">No history yet. Changes will appear here after the first save.</p>
          ) : (
            <ul>
              {revisions.map(rev => (
                <li key={rev.id} className="border-b border-zinc-800 px-4 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-200 truncate">{rev.title || "(no title)"}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{fmtTime(rev.created_at)}</p>
                      {JSON.parse(rev.tags_json).length > 0 && (
                        <p className="text-xs text-zinc-600 mt-1 truncate">{JSON.parse(rev.tags_json).join(", ")}</p>
                      )}
                    </div>
                    <button
                      onClick={() => restore.mutate(rev.id)}
                      disabled={restore.isPending}
                      className="shrink-0 text-xs px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50"
                    >
                      Restore
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );

  if (layout === "notes") {
    return (
      <>
        <div className="flex flex-col gap-3 p-4 h-[calc(100vh-2.75rem)] overflow-hidden">
          {topBar}
          <div className="flex gap-6 flex-1 min-h-0 overflow-hidden">
            <div className="flex flex-col gap-3 w-64 shrink-0 overflow-y-auto">
              <div className="aspect-video w-full shrink-0">{media}</div>
              {meta}
              {fields}
            </div>
            <div className="flex-1 min-h-0 flex flex-col">
              {notesPanel}
            </div>
          </div>
        </div>
        {historyPanel}
      </>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6 p-4 h-[calc(100vh-2.75rem)] overflow-hidden">
        <div className="flex flex-col gap-3 min-h-0">
          <div className="flex-1 min-h-0">{media}</div>
          {meta}
        </div>
        <div className="flex flex-col gap-3 min-h-0 overflow-hidden">
          {topBar}
          {fields}
          {notesPanel}
        </div>
      </div>
      {historyPanel}
    </>
  );
}
