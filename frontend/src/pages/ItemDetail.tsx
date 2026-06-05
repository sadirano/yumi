import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import MarkdownRenderer from "../components/MarkdownRenderer";
import { api, ItemStatus, RelatedLink, Revision, Space, itemLink } from "../api/client";
import { isSerialized } from "../lib/serialized";
import { anilistUrl } from "../lib/anilist";
import { DEFAULT_LABELS, STATUSES } from "../lib/status";
import TagInput from "../components/TagInput";

type Layout = "split" | "notes";

const DEFAULT_LEFT_W = 280;
const DEFAULT_RIGHT_W = 300;
const MIN_SIDE_W = 180;
const HANDLE_W = 6;

export default function ItemDetail() {
  const { id } = useParams();
  const itemId = Number(id);
  const qc = useQueryClient();
  const nav = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/";
  const fromSpaceId = from ? Number(new URLSearchParams(from).get("space")) || null : null;

  const { data: spaces = [] } = useQuery<Space[]>({
    queryKey: ["spaces"],
    queryFn: api.listSpaces,
    staleTime: 60_000,
  });
  const activeSpace = fromSpaceId != null ? spaces.find(s => s.id === fromSpaceId) ?? null : null;

  const { data: item, isLoading } = useQuery({
    queryKey: ["item", itemId],
    queryFn: () => api.getItem(itemId),
    enabled: !!itemId,
  });

  const [notes, setNotes] = useState("");
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [status, setStatus] = useState<ItemStatus>("plan");
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState<number | null>(null);
  const [anilistId, setAnilistId] = useState<number | null>(null);
  const [editingAnilist, setEditingAnilist] = useState(false);
  const [relatedLinks, setRelatedLinks] = useState<RelatedLink[]>([]);
  const [preview, setPreview] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [layout, setLayout] = useState<Layout>(() => {
    const saved = localStorage.getItem("yumi:defaultLayout");
    return saved === "notes" ? "notes" : "split";
  });

  function toggleLayout() {
    setLayout(prev => prev === "split" ? "notes" : "split");
  }

  // Resizable column widths.
  const [leftW, setLeftW] = useState(() => {
    const saved = localStorage.getItem("yumi:defaultLeftW");
    return saved ? Number(saved) : DEFAULT_LEFT_W;
  });
  const [rightW, setRightW] = useState(() => {
    const saved = localStorage.getItem("yumi:defaultRightW");
    return saved ? Number(saved) : DEFAULT_RIGHT_W;
  });
  const dragging = useRef<"left" | "right" | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [layoutSaved, setLayoutSaved] = useState(false);
  function saveLayoutAsDefault() {
    localStorage.setItem("yumi:defaultLayout", layout);
    localStorage.setItem("yumi:defaultLeftW", String(leftW));
    localStorage.setItem("yumi:defaultRightW", String(rightW));
    setLayoutSaved(true);
    setMenuOpen(false);
    setTimeout(() => setLayoutSaved(false), 2000);
  }

  // Pointer-based drag for resize handles.
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (dragging.current === "left") {
        const newW = Math.max(MIN_SIDE_W, Math.min(e.clientX - rect.left, rect.width - rightW - MIN_SIDE_W - HANDLE_W * 2));
        setLeftW(newW);
      } else {
        const newW = Math.max(MIN_SIDE_W, Math.min(rect.right - e.clientX, rect.width - leftW - MIN_SIDE_W - HANDLE_W * 2));
        setRightW(newW);
      }
    }
    function onUp() {
      dragging.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [leftW, rightW]);
  const ready = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const notesFileRef = useRef<HTMLInputElement>(null);
  const thumbFileRef = useRef<HTMLInputElement>(null);
  const attachFileRef = useRef<HTMLInputElement>(null);
  const notesCursor = useRef(0);

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
    setStatus(item.status);
    setProgress(item.progress);
    setTotal(item.total);
    setAnilistId(item.anilist_id);
    setEditingAnilist(false);
    setRelatedLinks(item.related_links);
    const t = setTimeout(() => { ready.current = true; }, 0);
    return () => clearTimeout(t);
  }, [item?.id]);

  // Ctrl+E toggles edit/preview for the notes panel.
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "e" && !e.shiftKey && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setPreview(p => !p);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  const save = useMutation({
    mutationFn: (data: { title: string; notes_md: string; tags: string[]; status: ItemStatus; progress: number; total: number | null; anilist_id: number | null; related_links: RelatedLink[] }) =>
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
      save.mutate({
        title, notes_md: notes, tags, status, progress, total,
        anilist_id: anilistId,
        related_links: relatedLinks.filter(l => l.url.trim()),
      });
    }, 800);
    return () => clearTimeout(t);
  }, [title, notes, tags, status, progress, total, anilistId, relatedLinks]);

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
      setStatus(updated.status);
      setProgress(updated.progress);
      setTotal(updated.total);
      setAnilistId(updated.anilist_id);
      setRelatedLinks(updated.related_links);
      setTimeout(() => { ready.current = true; }, 0);
      qc.invalidateQueries({ queryKey: ["item", itemId] });
      qc.invalidateQueries({ queryKey: ["items"] });
      setHistoryOpen(false);
    },
  });

  // An explicit open-the-resource click counts as one access (usage metrics).
  // Fire-and-forget, then refresh the item so the displayed count stays current.
  function pingAccess() {
    api.pingAccess(itemId)
      .then(() => qc.invalidateQueries({ queryKey: ["item", itemId] }))
      .catch(() => { });
  }

  useEffect(() => {
    if (!menuOpen) return;
    function onDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menuOpen]);

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

  const { data: attachments = [], refetch: refetchAttachments } = useQuery({
    queryKey: ["attachments", itemId],
    queryFn: () => api.listAttachments(itemId),
    enabled: !!itemId,
  });

  const uploadAttachment = useMutation({
    mutationFn: (file: File) => api.uploadAttachment(itemId, file),
    onSuccess: () => refetchAttachments(),
  });

  const deleteAttachment = useMutation({
    mutationFn: (name: string) => api.deleteAttachment(itemId, name),
    onSuccess: () => refetchAttachments(),
  });

  function fmtSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  const [editingLinkIdx, setEditingLinkIdx] = useState<number | null>(null);

  function updateLink(i: number, field: "label" | "url", val: string) {
    setRelatedLinks(prev => prev.map((l, j) => (j === i ? { ...l, [field]: val } : l)));
  }
  function addLink() {
    setRelatedLinks(prev => { setEditingLinkIdx(prev.length); return [...prev, { label: "", url: "" }]; });
  }
  function removeLink(i: number) {
    setRelatedLinks(prev => prev.filter((_, j) => j !== i));
    setEditingLinkIdx(null);
  }

  function faviconUrl(url: string): string {
    try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
    catch { return ""; }
  }
  function linkLabel(lnk: RelatedLink): string {
    if (lnk.label) return lnk.label;
    try { return new URL(lnk.url).hostname.replace(/^www\./, ""); }
    catch { return lnk.url; }
  }

  async function uploadImage(file: File): Promise<string> {
    const { url } = await api.uploadItemFile(itemId, file);
    return url;
  }

  async function handleThumbPaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.items)
      .find(it => it.kind === "file" && it.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const url = await uploadImage(file);
    setThumbInput(url);
  }

  async function handleNotesPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const file = Array.from(e.clipboardData.items)
      .find(it => it.kind === "file" && it.type.startsWith("image/"))
      ?.getAsFile();
    if (!file) return;
    e.preventDefault();
    const start = e.currentTarget.selectionStart;
    const end = e.currentTarget.selectionEnd;
    const url = await uploadImage(file);
    setNotes(prev => `${prev.slice(0, start)}![](${url})${prev.slice(end)}`);
  }

  async function handleNotesFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const pos = notesCursor.current;
    const url = await uploadImage(file);
    setNotes(prev => `${prev.slice(0, pos)}![](${url})${prev.slice(pos)}`);
  }

  async function handleThumbFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    const url = await uploadImage(file);
    setThumbInput(url);
  }

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
            onPaste={handleThumbPaste}
            onKeyDown={e => {
              if (e.key === "Enter") patchThumb.mutate(thumbInput.trim());
              if (e.key === "Escape") setThumbEdit(false);
            }}
            placeholder="Paste image or URL…"
            className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm outline-none focus:border-zinc-500"
          />
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => thumbFileRef.current?.click()}
              className="text-xs text-zinc-400 hover:text-zinc-200 border border-zinc-700 rounded px-2 py-1"
            >
              Choose file…
            </button>
            <input ref={thumbFileRef} type="file" accept="image/*" className="hidden" onChange={handleThumbFileSelect} />
          </div>
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
            <a href={item.url} target="_blank" rel="noreferrer" onClick={pingAccess} className="relative w-full h-full block group">
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
            <a href={item.url} target="_blank" rel="noreferrer" onClick={pingAccess} className="text-blue-400 underline">Open source</a>
          ) : (
            <span className="text-zinc-500 text-sm">No preview</span>
          )}
          <button
            onClick={() => { setThumbInput(item.thumbnail_url || ""); setThumbEdit(true); }}
            className="absolute bottom-2 right-2 px-2 py-1 text-xs bg-black/70 hover:bg-black/90 rounded md:opacity-0 md:group-hover/thumb:opacity-100 transition-opacity z-10"
          >
            Change image
          </button>
          {itemLink(item) && (
            <a
              href={itemLink(item)!}
              target="_blank"
              rel="noreferrer"
              onClick={pingAccess}
              className="absolute top-2 right-2 text-sm w-8 h-8 flex items-center justify-center rounded bg-black/80 hover:bg-blue-700 text-center z-10 md:opacity-0 md:group-hover/thumb:opacity-100 transition-opacity"
              title="Open link"
            >
              ↗
            </a>
          )}
        </>
      )}
    </div>
  );

  const meta = (
    <div className="flex items-center gap-2 text-xs text-zinc-400">
      {item.channel && <span>{item.channel}</span>}
      {item.published_at && <span>- {item.published_at}</span>}
      {item.access_count > 0 && (
        <span title={item.last_accessed_at ? `last opened ${fmtTime(item.last_accessed_at)}` : undefined}>
          opened {item.access_count}×{item.last_accessed_at ? ` · ${fmtTime(item.last_accessed_at)}` : ""}
        </span>
      )}
    </div>
  );

  const notesHeader = (
    <div className="flex items-center justify-between text-xs text-zinc-400 mb-1">
      <span>Notes</span>
      <div className="flex items-center gap-2">
        {!preview && (
          <>
            <button
              type="button"
              onClick={() => notesFileRef.current?.click()}
              className="hover:text-zinc-100"
              title="Insert image"
            >
              image
            </button>
            <input ref={notesFileRef} type="file" accept="image/*" className="hidden" onChange={handleNotesFileSelect} />
          </>
        )}
        <button onClick={() => setPreview(p => !p)} className="hover:text-zinc-100">
          {preview ? "edit" : "preview"}
          <kbd className="ml-1.5 text-[10px] text-zinc-600">Ctrl+E</kbd>
        </button>
      </div>
    </div>
  );

  // Used in fixed-height desktop layouts where the notes fill remaining space.
  const notesPanelFill = (
    <div className="flex-1 min-h-0 flex flex-col">
      {notesHeader}
      {preview ? (
        <div className="flex-1 overflow-auto bg-zinc-900 rounded p-3 border border-zinc-800">
          <MarkdownRenderer>{notes || "_no notes_"}</MarkdownRenderer>
        </div>
      ) : (
        <textarea
          autoFocus
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onPaste={handleNotesPaste}
          onSelect={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          onKeyUp={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          className="flex-1 resize-none bg-zinc-900 rounded p-3 border border-zinc-800 font-mono text-sm"
          placeholder="What did you think? Key takeaways. Timestamps. Anything searchable."
        />
      )}
    </div>
  );

  // Used in scrollable layouts (mobile + desktop split right column).
  const notesPanel = (
    <div className="flex flex-col">
      {notesHeader}
      {preview ? (
        <div className="bg-zinc-900 rounded p-3 border border-zinc-800 min-h-[8rem]">
          <MarkdownRenderer>{notes || "_no notes_"}</MarkdownRenderer>
        </div>
      ) : (
        <textarea
          autoFocus
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onPaste={handleNotesPaste}
          onSelect={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          onKeyUp={e => { notesCursor.current = e.currentTarget.selectionStart; }}
          className="w-full resize-none bg-zinc-900 rounded p-3 border border-zinc-800 font-mono text-sm min-h-[12rem]"
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
                    onPointerDown={() => {
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
        <TagInput value={tags} onChange={setTags} allowedNamespaces={activeSpace?.namespaces} />
      </div>
      {item.kind !== "note" && (
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">status</label>
          <select value={status} onChange={e => setStatus(e.target.value as ItemStatus)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm">
            {STATUSES.map(s => <option key={s} value={s}>{DEFAULT_LABELS[s]}</option>)}
          </select>
        </div>
      )}
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
      {isSerialized(tags) && (
        <div>
          <label className="text-xs text-zinc-400 mb-1 block">AniList id</label>
          {anilistId != null && !editingAnilist ? (
            // Once an id is set, show it as the link itself; "edit" reopens the input.
            <div className="flex items-center gap-2">
              <a
                href={anilistUrl(anilistId, tags)}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-400 hover:underline"
              >
                #{anilistId} ↗
              </a>
              <button type="button" onClick={() => setEditingAnilist(true)} className="text-xs text-zinc-500 hover:text-zinc-300">edit</button>
              <button type="button" onClick={() => { setAnilistId(null); setEditingAnilist(false); }} className="text-xs text-zinc-600 hover:text-red-400">clear</button>
            </div>
          ) : (
            <input
              type="number"
              min={0}
              autoFocus={editingAnilist}
              value={anilistId ?? ""}
              onFocus={() => setEditingAnilist(true)}
              onChange={e => {
                const v = e.target.value.trim();
                setAnilistId(v === "" ? null : Math.max(0, Math.floor(Number(v) || 0)));
              }}
              onBlur={() => setEditingAnilist(false)}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              placeholder="e.g. 154587"
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-sm"
            />
          )}
        </div>
      )}
      <div>
        <label className="text-xs text-zinc-400 mb-1 block">related links</label>
        <div className="space-y-1">
          {relatedLinks.map((lnk, i) => (
            editingLinkIdx === i ? (
              <div key={i} className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={lnk.label}
                  onChange={e => updateLink(i, "label", e.target.value)}
                  placeholder="label"
                  className="w-24 shrink-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm"
                />
                <input
                  value={lnk.url}
                  onChange={e => updateLink(i, "url", e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") setEditingLinkIdx(null); }}
                  placeholder="https://…"
                  className="flex-1 min-w-0 bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-sm"
                />
                <button type="button" onClick={() => setEditingLinkIdx(null)} className="text-xs text-zinc-400 hover:text-zinc-100">done</button>
                <button type="button" onClick={() => removeLink(i)} className="text-zinc-600 hover:text-red-400 text-sm" title="remove">✕</button>
              </div>
            ) : (
              <div key={i} className="flex items-center gap-2 group/link">
                <a
                  href={lnk.url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1.5 flex-1 min-w-0 text-sm text-blue-400 hover:underline"
                >
                  {lnk.url && (
                    <img
                      src={faviconUrl(lnk.url)}
                      alt=""
                      className="w-4 h-4 rounded shrink-0"
                      onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    />
                  )}
                  <span className="truncate">{linkLabel(lnk)}</span>
                  <span className="text-zinc-500">↗</span>
                </a>
                <button type="button" onClick={() => setEditingLinkIdx(i)} className="text-xs text-zinc-500 hover:text-zinc-300 opacity-0 group-hover/link:opacity-100">edit</button>
                <button type="button" onClick={() => removeLink(i)} className="text-zinc-600 hover:text-red-400 text-sm opacity-0 group-hover/link:opacity-100" title="remove">✕</button>
              </div>
            )
          ))}
        </div>
        <button type="button" onClick={addLink} className="mt-1.5 text-xs text-zinc-400 hover:text-zinc-100">+ add link</button>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs text-zinc-400">files</label>
          <button
            type="button"
            onClick={() => attachFileRef.current?.click()}
            disabled={uploadAttachment.isPending}
            className="text-xs text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
          >
            {uploadAttachment.isPending ? "uploading…" : "+ attach"}
          </button>
          <input
            ref={attachFileRef}
            type="file"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) { uploadAttachment.mutate(file); e.target.value = ""; }
            }}
          />
        </div>
        {attachments.length > 0 && (
          <div className="space-y-1">
            {attachments.map(att => (
              <div key={att.name} className="flex items-center gap-2 group/att">
                <a
                  href={att.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex-1 min-w-0 flex items-center gap-1.5 text-sm text-blue-400 hover:underline"
                >
                  <span className="truncate">{att.name}</span>
                  <span className="text-zinc-600 text-xs shrink-0">{fmtSize(att.size)}</span>
                </a>
                <button
                  type="button"
                  onClick={() => deleteAttachment.mutate(att.name)}
                  className="text-zinc-600 hover:text-red-400 text-sm opacity-0 group-hover/att:opacity-100 shrink-0"
                  title="remove"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {item.needs_enrichment && (
        <div className="text-xs text-amber-300 bg-amber-950/40 border border-amber-900 rounded p-2">
          Enrichment failed. Try "Re-fetch metadata" in the ... menu.
        </div>
      )}
    </>
  );

  const topBar = (
    <div className="flex items-center gap-2 shrink-0">
      <button onClick={() => nav(-1)} className="text-xs text-zinc-400 hover:text-zinc-100">back</button>
      <span className={`ml-2 text-xs transition-opacity duration-500 ${saveStatus === "idle" ? "opacity-0" : "opacity-100"} ${saveStatus === "saved" ? "text-zinc-400" : "text-zinc-500"}`}>
        {saveStatus === "saving" ? "Saving..." : "Saved"}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggleLayout}
          className="hidden md:block text-xs text-zinc-500 hover:text-zinc-300 px-2 py-1 rounded hover:bg-zinc-800"
          title={layout === "split" ? "3-column layout" : "2-column layout"}
        >
          {layout === "split" ? "☰ focus" : "⬒ split"}
        </button>
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
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
                className="w-full text-left px-3 py-2 text-sm hover:bg-zinc-800 hidden md:block"
                onMouseDown={saveLayoutAsDefault}
              >
                {layoutSaved ? "✓ Saved!" : "Save layout as default"}
              </button>
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
      <div className="w-full md:w-80 bg-zinc-900 border-l border-zinc-800 h-full flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
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

  return (
    <>
      {/* ── Mobile: single scrollable column ─────────────────────── */}
      <div className="md:hidden flex flex-col">
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800 px-4 py-2 shrink-0">
          {topBar}
        </div>
        <div className="aspect-video shrink-0">{media}</div>
        <div className="px-4 py-2 border-b border-zinc-800">{meta}</div>
        <div className="flex flex-col gap-4 p-4 pb-10">
          {fields}
          {notesPanel}
        </div>
      </div>

      {/* ── Desktop: notes-focused 3-column layout ──────────────── */}
      {layout === "notes" && (
        <div
          ref={containerRef}
          className="hidden md:flex h-[calc(100vh-2.75rem)] overflow-hidden"
        >
          {/* Left column — image + meta */}
          <div
            className="flex flex-col gap-3 p-4 overflow-y-auto shrink-0"
            style={{ width: leftW }}
          >
            <div className="aspect-video w-full shrink-0">{media}</div>
            {meta}
          </div>

          {/* Resize handle — left */}
          <div
            className="shrink-0 cursor-col-resize flex items-center justify-center hover:bg-zinc-700/40 active:bg-zinc-600/40 transition-colors"
            style={{ width: HANDLE_W }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = "left";
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          >
            <div className="w-px h-8 bg-zinc-700 rounded-full" />
          </div>

          {/* Center column — topBar + notes */}
          <div className="flex-1 min-w-0 flex flex-col gap-3 p-4 overflow-hidden">
            {topBar}
            {notesPanelFill}
          </div>

          {/* Resize handle — right */}
          <div
            className="shrink-0 cursor-col-resize flex items-center justify-center hover:bg-zinc-700/40 active:bg-zinc-600/40 transition-colors"
            style={{ width: HANDLE_W }}
            onPointerDown={(e) => {
              e.preventDefault();
              dragging.current = "right";
              document.body.style.cursor = "col-resize";
              document.body.style.userSelect = "none";
            }}
          >
            <div className="w-px h-8 bg-zinc-700 rounded-full" />
          </div>

          {/* Right column — fields */}
          <div
            className="flex flex-col gap-3 p-4 overflow-y-auto shrink-0"
            style={{ width: rightW }}
          >
            {fields}
          </div>
        </div>
      )}

      {/* ── Desktop: split layout (2-column, original) ────────────── */}
      {layout === "split" && (
        <div className="hidden md:grid md:grid-cols-[2fr_3fr] gap-6 p-4 h-[calc(100vh-2.75rem)] overflow-hidden">
          <div className="flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-0">{media}</div>
            {meta}
          </div>
          <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pb-4">
            {topBar}
            {fields}
            {notesPanel}
          </div>
        </div>
      )}

      {historyPanel}
    </>
  );
}
