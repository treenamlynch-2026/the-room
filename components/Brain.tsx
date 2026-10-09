"use client";
import { useEffect, useRef, useState } from "react";
import type { AgentId, CanonEntry, Message, ProjectState } from "@/lib/types";
import { api } from "./api";
import { AGENT_LABEL, Btn, Dot, Toggle, excerpt } from "./ui";

export type Tab = "canon" | "files" | "decisions" | "agents";
const TABS: { id: Tab; label: string }[] = [
  { id: "canon", label: "Canon" }, { id: "files", label: "Files" }, { id: "decisions", label: "Decisions" }, { id: "agents", label: "Agents" },
];

const input = "w-full rounded-lg border border-line2 bg-panel px-2.5 py-2 text-sm text-ink outline-none focus:border-human";

export function Brain({ state, tab, setTab, reload, onStop, onRetry, editCanonId, clearEditCanon }: {
  state: ProjectState; tab: Tab; setTab: (t: Tab) => void; reload: () => Promise<void>;
  onStop: (m: Message) => void; onRetry: (m: Message) => void;
  editCanonId: string | null; clearEditCanon: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" className="flex gap-0.5 border-b border-line px-3">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`h-10 border-b-2 px-2.5 text-[13px] font-medium ${tab === t.id ? "border-[#5B9BF0] text-ink" : "border-transparent text-mute"}`}>
            {t.label}
            {t.id === "canon" && <span className="ml-1 text-mute">{state.canon.filter((c) => c.active).length}</span>}
            {t.id === "decisions" && <span className="ml-1 text-mute">{state.decisions.length}</span>}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3.5">
        {tab === "canon" && <CanonTab state={state} reload={reload} editId={editCanonId} clearEdit={clearEditCanon} />}
        {tab === "files" && <FilesTab state={state} reload={reload} />}
        {tab === "decisions" && <DecisionsTab state={state} reload={reload} />}
        {tab === "agents" && <AgentsTab state={state} reload={reload} onStop={onStop} onRetry={onRetry} />}
      </div>
    </div>
  );
}

function CanonTab({ state, reload, editId, clearEdit }: { state: ProjectState; reload: () => Promise<void>; editId: string | null; clearEdit: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { if (editId) { setEditing(editId); clearEdit(); } }, [editId, clearEdit]);
  const patch = async (id: string, p: Partial<CanonEntry>) => { await api(`/api/canon/${id}`, { method: "PATCH", body: p }); await reload(); };
  const add = async () => {
    await api(`/api/projects/${state.project.id}/canon`, { body: { title: "New canon entry", body: "", priority: 2 } });
    await reload();
  };
  return (
    <div className="flex flex-col gap-2.5">
      <div className="rounded-lg border border-[#2C4470] bg-[#14213A] px-3 py-2.5 text-xs text-[#C9DCF8]">
        Active entries are supplied to every model call. Human-approved canon overrides generated suggestions.
      </div>
      {state.canon.map((c) => editing === c.id
        ? <CanonEditor key={c.id} c={c} onSave={async (p) => { await patch(c.id, p); setEditing(null); }} onCancel={() => setEditing(null)}
            onDelete={async () => { await api(`/api/canon/${c.id}`, { method: "DELETE" }); setEditing(null); await reload(); }} />
        : (
          <div key={c.id} className={`flex flex-col gap-1.5 rounded-xl border border-[#222C3A] bg-card p-3 ${c.active ? "" : "opacity-50"}`}>
            <div className="flex items-center gap-2">
              {c.pinned && <span title="Pinned" className="text-human">●</span>}
              <strong className="flex-1 text-sm">{c.title}</strong>
              <span className="rounded-md bg-[#1F2A3A] px-1.5 py-0.5 font-mono text-[11px] text-[#B7D3FA]">P{c.priority}</span>
            </div>
            {c.body && <div className="whitespace-pre-wrap text-[13px] text-ink2">{excerpt(c.body, 400)}</div>}
            {c.source && <div className="font-mono text-[11px] text-mute">source: {c.source}</div>}
            <div className="flex flex-wrap gap-1.5">
              <Btn onClick={() => patch(c.id, { pinned: !c.pinned })}>{c.pinned ? "Unpin" : "Pin"}</Btn>
              <Btn onClick={() => setEditing(c.id)}>Edit</Btn>
              <Toggle on={c.active} label="Active" onClick={() => patch(c.id, { active: !c.active })} />
            </div>
          </div>
        ))}
      <Btn tone="human" className="h-9 justify-center" onClick={add}>+ New canon entry</Btn>
    </div>
  );
}

function CanonEditor({ c, onSave, onCancel, onDelete }: { c: CanonEntry; onSave: (p: Partial<CanonEntry>) => void; onCancel: () => void; onDelete: () => void }) {
  const [f, setF] = useState({ title: c.title, body: c.body, priority: c.priority, source: c.source });
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-[#2C4470] bg-card p-3">
      <label className="text-xs text-mute">Title<input className={input} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="text-xs text-mute">Body<textarea className={`${input} min-h-28`} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      <div className="flex gap-2">
        <label className="text-xs text-mute">Priority
          <select className={input} value={f.priority} onChange={(e) => setF({ ...f, priority: Number(e.target.value) })}>
            <option value={1}>P1 — highest</option><option value={2}>P2</option><option value={3}>P3</option>
          </select>
        </label>
        <label className="flex-1 text-xs text-mute">Source / reference<input className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></label>
      </div>
      <div className="flex gap-1.5">
        <Btn tone="human" onClick={() => onSave(f)}>Save</Btn>
        <Btn onClick={onCancel}>Cancel</Btn>
        <span className="flex-1" />
        <Btn onClick={onDelete}>Delete</Btn>
      </div>
    </div>
  );
}

function FilesTab({ state, reload }: { state: ProjectState; reload: () => Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true); setErr("");
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("file", f);
    const res = await fetch(`/api/projects/${state.project.id}/files`, { method: "POST", body: fd });
    if (!res.ok) setErr((await res.json().catch(() => ({}))).error || "Upload failed");
    setBusy(false);
    if (ref.current) ref.current.value = "";
    await reload();
  };
  const n = state.files.filter((f) => f.inContext).length;
  return (
    <div className="flex flex-col gap-2.5">
      {state.files.map((f) => (
        <div key={f.id} className="flex flex-col gap-2 rounded-xl border border-[#222C3A] bg-card p-3">
          <div className="flex items-start gap-2.5">
            {f.kind === "image" && <img src={`/api/files/${f.id}`} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" />}
            <div className="min-w-0 flex-1">
              <a href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" className="block break-all font-mono text-xs text-ink hover:text-human">{f.name}</a>
              <div className="font-mono text-[11px] text-mute">
                {f.kind} · {f.size > 1048576 ? `${(f.size / 1048576).toFixed(1)} MB` : `${Math.ceil(f.size / 1024)} KB`}{f.note ? ` · ${f.note}` : ""}{f.messageId ? " · attached to a message" : ""}
              </div>
            </div>
          </div>
          <div className="flex gap-1.5">
            <Toggle on={f.inContext} label={f.inContext ? "Pinned: every call" : f.messageId ? "Pin to every call" : "Not sent"}
              onClick={async () => { await api(`/api/files/${f.id}`, { method: "PATCH", body: { inContext: !f.inContext } }); await reload(); }} />
            <Btn onClick={async () => { await api(`/api/files/${f.id}`, { method: "DELETE" }); await reload(); }}>Delete</Btn>
          </div>
        </div>
      ))}
      <p className="text-xs text-mute">{n} of {state.files.length} files pinned to every call. Both models see pinned images, PDFs and video frames (+ transcript). Media costs tokens on every call, so unpin what isn’t needed; videos start unpinned. Files attached in the message box are sent with that message only.</p>
      <input ref={ref} type="file" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
      <Btn tone="human" className="h-9 justify-center" disabled={busy} onClick={() => ref.current?.click()}>{busy ? "Uploading… (videos: extracting frames + transcript)" : "+ Upload files"}</Btn>
      {err && <p className="text-xs text-[#F2B8B8]">{err}</p>}
    </div>
  );
}

function DecisionsTab({ state, reload }: { state: ProjectState; reload: () => Promise<void> }) {
  const [text, setText] = useState("");
  const [edit, setEdit] = useState<{ id: string; text: string } | null>(null);
  const add = async () => {
    if (!text.trim()) return;
    await api(`/api/projects/${state.project.id}/decisions`, { body: { text } });
    setText(""); await reload();
  };
  return (
    <div className="flex flex-col gap-2.5">
      {state.decisions.map((d) => edit?.id === d.id ? (
        <div key={d.id} className="flex flex-col gap-2 rounded-xl border border-[#2C4470] bg-card p-3">
          <textarea className={`${input} min-h-20`} value={edit.text} onChange={(e) => setEdit({ ...edit, text: e.target.value })} />
          <div className="flex gap-1.5">
            <Btn tone="human" onClick={async () => { await api(`/api/decisions/${d.id}`, { method: "PATCH", body: { text: edit.text } }); setEdit(null); await reload(); }}>Save</Btn>
            <Btn onClick={() => setEdit(null)}>Cancel</Btn>
            <span className="flex-1" />
            <Btn onClick={async () => { await api(`/api/decisions/${d.id}`, { method: "DELETE" }); setEdit(null); await reload(); }}>Delete</Btn>
          </div>
        </div>
      ) : (
        <button key={d.id} onClick={() => setEdit({ id: d.id, text: d.text })}
          className="flex items-start gap-2.5 rounded-xl border border-[#222C3A] bg-card p-3 text-left hover:border-line2">
          <span className="text-[13px] text-gpt-l">✓</span>
          <span className="flex-1 whitespace-pre-wrap text-sm">{d.text}</span>
        </button>
      ))}
      <textarea className={`${input} min-h-16`} placeholder="Record a decision…" value={text} onChange={(e) => setText(e.target.value)} />
      <Btn tone="human" className="h-9 justify-center" onClick={add}>+ Add decision</Btn>
      <p className="text-xs text-mute">Promote any message with “Save as Decision.” Click a decision to edit it.</p>
    </div>
  );
}

function AgentsTab({ state, reload, onStop, onRetry }: { state: ProjectState; reload: () => Promise<void>; onStop: (m: Message) => void; onRetry: (m: Message) => void }) {
  const [models, setModels] = useState<Record<AgentId, string[]> | null>(null);
  const [sumBusy, setSumBusy] = useState(false);
  const [sumErr, setSumErr] = useState("");
  useEffect(() => { api<Record<AgentId, string[]>>("/api/models").then(setModels).catch(() => setModels({ chatgpt: [], claude: [] })); }, []);
  const msgs = state.messages;
  const recentWindow = 30;
  const layers = [
    ["A", "Room rules", "system prompt"],
    ["B", "Canon", `${state.canon.filter((c) => c.active).length} active`],
    ["C", "Decisions", `${state.decisions.length}`],
    ["D", "Files", `${state.files.filter((f) => f.inContext).length} of ${state.files.length}`],
    ["E", "Recent conversation", `last ${recentWindow} msgs`],
    ["F", "Summary", state.project.conversationSummary ? "present" : "none"],
  ];
  return (
    <div className="flex flex-col gap-3">
      {(["chatgpt", "claude"] as AgentId[]).map((a) => {
        const mine = msgs.filter((m) => m.author === a);
        const live = mine.find((m) => m.status === "streaming" || m.status === "queued");
        const last = mine[mine.length - 1];
        const trigger = live ? msgs.find((m) => m.id === live.replyToId) : null;
        const tot = mine.reduce((s, m) => ({ i: s.i + (m.usage?.inputTokens || 0), o: s.o + (m.usage?.outputTokens || 0) }), { i: 0, o: 0 });
        const cur = state.project.models[a];
        const curDeep = state.project.deepModels[a];
        const opts = (c: string) => Array.from(new Set([c, ...(models?.[a] || [])]));
        const setModel = async (key: string, v: string) => { await api(`/api/projects/${state.project.id}`, { method: "PATCH", body: { [key]: v } }); await reload(); };
        const job = live ? ({ review: "Reviewing", handoff: "Implementing" } as Record<string, string>)[live.routing?.mode || ""] || "Responding" : null;
        return (
          <div key={a} className={`flex flex-col gap-2 rounded-xl border bg-card p-3 ${live ? (a === "claude" ? "border-[#5A3F1C]" : "border-[#1E4A42]") : "border-[#222C3A]"}`}>
            <div className="flex items-center gap-2">
              <Dot className={a === "chatgpt" ? "bg-gpt" : "bg-cl"} />
              <strong className="text-sm">{AGENT_LABEL[a]}</strong>
              <span className="ml-auto font-mono text-[11px] text-mute">{live ? "streaming" : last?.status === "error" ? "error" : "idle"}</span>
            </div>
            <div className="text-[13px] text-ink2">
              {live ? `${job}: “${excerpt(trigger?.content || "", 60)}”` : last ? `Last: ${excerpt(last.content || last.error || "", 60)}` : "No messages yet"}
            </div>
            <label className="text-xs text-mute">Everyday model
              <select className={input} value={cur} onChange={(e) => setModel(a === "chatgpt" ? "modelChatgpt" : "modelClaude", e.target.value)}>
                {opts(cur).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <label className="text-xs text-mute">Deep model (Deep button / Deep review)
              <select className={input} value={curDeep} onChange={(e) => setModel(a === "chatgpt" ? "modelChatgptDeep" : "modelClaudeDeep", e.target.value)}>
                {opts(curDeep).map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <div className="font-mono text-[11px] text-mute">
              last call {last?.usage ? `${last.usage.inputTokens} in / ${last.usage.outputTokens} out` : "—"} · project total {tot.i} in / {tot.o} out tokens
            </div>
            <div className="flex gap-1.5">
              {live && <Btn onClick={() => onStop(live)}>Cancel</Btn>}
              {!live && last && <Btn onClick={() => onRetry(last)}>Retry last</Btn>}
            </div>
          </div>
        );
      })}
      <div className="flex flex-col gap-2 rounded-xl border border-[#222C3A] bg-card p-3">
        <div className="flex items-center justify-between"><strong className="text-sm">Context sent per call</strong><span className="font-mono text-[11px] text-mute">priority ↓</span></div>
        {layers.map(([k, n, d]) => (
          <div key={k} className="flex items-baseline gap-2.5 text-[13px]">
            <span className="rounded-md bg-[#1F2A3A] px-1.5 font-mono text-[11px] text-[#B7D3FA]">{k}</span>
            <span className="flex-1 text-ink2">{n}</span><span className="font-mono text-[11px] text-mute">{d}</span>
          </div>
        ))}
        <p className="text-xs text-mute">Conflicts resolve: your instruction › Canon › Decisions › Files › Recent › AI history. Models are told to surface conflicts, not pick silently.</p>
      </div>
      <div className="flex flex-col gap-2 rounded-xl border border-[#222C3A] bg-card p-3">
        <strong className="text-sm">Conversation summary</strong>
        {state.project.conversationSummary
          ? <div className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-ink2">{state.project.conversationSummary}</div>
          : <p className="text-xs text-mute">None yet. Messages older than the recent window are dropped from context until summarized.</p>}
        <Btn disabled={sumBusy} onClick={async () => {
          setSumBusy(true); setSumErr("");
          try { await api(`/api/projects/${state.project.id}/summarize`, { body: {} }); await reload(); }
          catch (e) { setSumErr(e instanceof Error ? e.message : String(e)); }
          setSumBusy(false);
        }}>{sumBusy ? "Summarizing…" : "Summarize older messages (uses Claude)"}</Btn>
        {sumErr && <p className="text-xs text-[#F2B8B8]">{sumErr}</p>}
      </div>
    </div>
  );
}
