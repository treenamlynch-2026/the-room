"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentId, Message, Project, ProjectFile, ProjectState, RoutingMode, StreamEvent } from "@/lib/types";
import { api, isUnreachable, streamPost } from "./api";
import { Brain, type Tab } from "./Brain";
import { MessageView, type MsgActions } from "./MessageView";
import { useBuildWatch } from "./useBuildWatch";
import { AGENT_LABEL, Btn, CopyBtn, Dot, Icon, IconBtn, NAME, OTHER, Resizer, excerpt, fmtTime } from "./ui";

const LEFT_W = 232, RIGHT_W = 330;

type Route = "both" | AgentId;
const ROUTES: { id: Route; label: string; dot: string }[] = [
  { id: "both", label: "Ask both", dot: "bg-human" },
  { id: "chatgpt", label: "Iris", dot: "bg-gpt" },
  { id: "claude", label: "Claude", dot: "bg-cl" },
];
const HINT: Record<Route, string> = {
  both: "Both respond in parallel. Neither sees the other’s reply until the next turn.",
  chatgpt: "Only Iris responds. Claude sees it in history.",
  claude: "Only Claude responds. Iris sees it in history.",
};
const agentsFor = (r: Route): AgentId[] => (r === "both" ? ["chatgpt", "claude"] : [r]);

/**
 * @mentions say who a message is ADDRESSED to. They only ever ADD recipients, never remove one:
 * "@claude" mid-sentence used to switch routing to Claude-only (and leave the chip there), cutting Iris out.
 * Exclusive routing is done only with the explicit chips / buttons. Aliases: @iris = @chatgpt, @both.
 */
function parseMentions(text: string): AgentId[] {
  const t = text.toLowerCase();
  const out: AgentId[] = [];
  const both = /(^|[^\w@])@both\b/.test(t);
  if (both || /(^|[^\w@])@(iris|chatgpt)\b/.test(t)) out.push("chatgpt");
  if (both || /(^|[^\w@])@claude\b/.test(t)) out.push("claude");
  return out;
}
const union = (a: AgentId[], b: AgentId[]): AgentId[] => (["chatgpt", "claude"] as AgentId[]).filter((x) => a.includes(x) || b.includes(x));

export default function Room() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [pid, setPid] = useState<string | null>(null);
  const [state, setState] = useState<ProjectState | null>(null);
  const [tab, setTab] = useState<Tab>("canon");
  const [route, setRoute] = useState<Route>("both");
  const [drawer, setDrawer] = useState(false);
  const [brainSheet, setBrainSheet] = useState(false);
  const [brainCollapsed, setBrainCollapsed] = useState(false);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Message[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [saved, setSaved] = useState<Set<string>>(new Set());
  const [editCanonId, setEditCanonId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [deep, setDeep] = useState(false);
  const [pending, setPending] = useState<{ id: string; name: string; kind: string; note: string | null }[]>([]);
  const [uploading, setUploading] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [view, setView] = useState<"thread" | "split">("thread");
  const paneRefs = useRef<Record<AgentId, HTMLDivElement | null>>({ chatgpt: null, claude: null });
  const paneStick = useRef<Record<AgentId, boolean>>({ chatgpt: true, claude: true });
  const fileRef = useRef<HTMLInputElement>(null);

  const [leftW, setLeftW] = useState(LEFT_W);
  const [rightW, setRightW] = useState(RIGHT_W);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const layoutLoaded = useRef(false);

  useEffect(() => {
    try {
      const v = localStorage.getItem("room.view"); if (v === "split" || v === "thread") setView(v);
      const l = Number(localStorage.getItem("room.leftW")); if (l) setLeftW(l);
      const r = Number(localStorage.getItem("room.rightW")); if (r) setRightW(r);
      setLeftCollapsed(localStorage.getItem("room.leftCollapsed") === "1");
      setBrainCollapsed(localStorage.getItem("room.brainCollapsed") === "1");
    } catch {}
    layoutLoaded.current = true;
  }, []);
  useEffect(() => {
    if (!layoutLoaded.current) return;
    try {
      localStorage.setItem("room.leftW", String(leftW)); localStorage.setItem("room.rightW", String(rightW));
      localStorage.setItem("room.leftCollapsed", leftCollapsed ? "1" : "0"); localStorage.setItem("room.brainCollapsed", brainCollapsed ? "1" : "0");
    } catch {}
  }, [leftW, rightW, leftCollapsed, brainCollapsed]);
  const changeView = (v: "thread" | "split") => {
    setView(v); stick.current = true; paneStick.current = { chatgpt: true, claude: true };
    try { localStorage.setItem("room.view", v); } catch {}
  };

  const loadProjects = useCallback(async () => {
    const ps = await api<Project[]>("/api/projects");
    setProjects(ps);
    return ps;
  }, []);

  const reload = useCallback(async () => {
    if (!pid) return;
    try { setState(await api<ProjectState>(`/api/projects/${pid}`)); }
    catch (e) { if (isUnreachable(e)) reconnectRef.current(); else throw e; }
  }, [pid]);

  /**
   * Server unreachable (stopped, restarting, connection dropped): poll /api/health with backoff
   * (1s, 2s, 4s … capped at 15s) until it answers, then reload projects and the conversation.
   */
  const [conn, setConn] = useState<{ lost: boolean; attempt: number }>({ lost: false, attempt: 0 });
  const reconnecting = useRef(false);
  const kick = useRef<() => void>(() => {});
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const reconnectRef = useRef<() => void>(() => {});
  reconnectRef.current = () => {
    if (reconnecting.current) return;
    reconnecting.current = true;
    (async () => {
      for (let attempt = 1; ; attempt++) {
        try { const r = await fetch("/api/health", { cache: "no-store" }); if (r.ok) break; } catch {}
        setConn({ lost: true, attempt });
        await new Promise<void>((res) => { const t = setTimeout(res, Math.min(15_000, 1000 * 2 ** (attempt - 1))); kick.current = () => { clearTimeout(t); res(); }; });
      }
      reconnecting.current = false;
      setConn({ lost: false, attempt: 0 });
      setErr("");
      setResetNote((n) => (n?.includes("unreachable") ? "Hard reset: the Room server is back. Browser state was cleared." : n));
      try { await loadProjects(); await reloadRef.current(); } catch {}
    })();
  };

  useEffect(() => {
    loadProjects().then((ps) => {
      let last: string | null = null;
      try { last = localStorage.getItem("room.project"); } catch {}
      setPid(ps.find((p) => p.id === last)?.id || ps[0]?.id || null);
    }).catch((e) => setErr(String(e)));
  }, [loadProjects]);

  useEffect(() => {
    if (!pid) return;
    try { localStorage.setItem("room.project", pid); } catch {}
    setState(null); setSaved(new Set()); stick.current = true;
    api<ProjectState>(`/api/projects/${pid}`).then((s) => {
      setState(s);
      const lastAI = [...s.messages].reverse().find((m) => m.author === "chatgpt" || m.author === "claude");
      setRoute(s.project.defaultRouting === "last-agent" && lastAI ? (lastAI.author as AgentId) : "both");
    });
  }, [pid]);

  // While anything is streaming in another tab or after reconnect, poll so the view stays current.
  const anyLive = !!state?.messages.some((m) => m.status === "streaming" || m.status === "queued");
  const localStreams = useRef(0);
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => { if (!localStreams.current && !reconnecting.current) reload().catch(() => {}); }, 1500);
    return () => clearInterval(t);
  }, [anyLive, reload]);

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
    for (const a of ["chatgpt", "claude"] as AgentId[]) {
      const p = paneRefs.current[a];
      if (p && paneStick.current[a]) p.scrollTop = p.scrollHeight;
    }
  }, [state?.messages, view]);

  const applyEvent = useCallback((e: StreamEvent) => {
    setState((s) => {
      if (!s) return s;
      if (e.type === "message") {
        const i = s.messages.findIndex((m) => m.id === e.message.id);
        const messages = i >= 0 ? s.messages.map((m, j) => (j === i ? e.message : m)) : [...s.messages, e.message];
        return { ...s, messages };
      }
      if (e.type === "delta") return { ...s, messages: s.messages.map((m) => (m.id === e.id ? { ...m, content: m.content + e.text } : m)) };
      if (e.type === "status")
        return { ...s, messages: s.messages.map((m) => (m.id === e.id ? { ...m, status: e.status, usage: e.usage ?? m.usage, error: e.error ?? null, model: e.model ?? m.model } : m)) };
      return s;
    });
  }, []);

  /** Returns "unsent" when the request never reached the server, so the caller can put the message back. */
  const stream = useCallback(async (url: string, body: unknown): Promise<"unsent" | void> => {
    setErr(""); stick.current = true; paneStick.current = { chatgpt: true, claude: true }; localStreams.current++;
    try { await streamPost(url, body, applyEvent); }
    catch (e) {
      // Server gone or connection cut: don't leave a dead error banner — reconnect, then reload what the server saved.
      if (isUnreachable(e)) { reconnectRef.current(); if (!e.sent) return "unsent"; }
      else setErr(e instanceof Error ? e.message : String(e));
    }
    finally { localStreams.current--; await reload().catch(() => {}); }
  }, [applyEvent, reload]);

  const send = useCallback((content: string, agents: AgentId[], mode?: RoutingMode, author: "human" | "system" = "human", replyToId?: string, opts: { deep?: boolean; fileIds?: string[]; addressed?: AgentId[] } = {}) => {
    if (!pid) return;
    return stream(`/api/projects/${pid}/send`, { content, agents, mode, author, replyToId, deep: !!opts.deep, fileIds: opts.fileIds, addressed: opts.addressed });
  }, [pid, stream]);

  const submit = () => {
    const content = text.trim() || (pending.length ? `Attached: ${pending.map((f) => f.name).join(", ")}` : "");
    if (!content || uploading) return;
    // Recipients = the chip selection plus anyone @mentioned. The chip is left as it was.
    const addressed = parseMentions(content);
    const agents = union(agentsFor(route), addressed);
    setText("");
    const fileIds = pending.map((f) => f.id), files = pending;
    setPending([]);
    const d = deep;
    setDeep(false);
    send(content, agents, undefined, "human", undefined, { deep: d, fileIds, addressed })?.then((res) => {
      if (res !== "unsent") return;
      // Never lose a message to a dead connection: put it back so it can be sent once the server is back.
      setText((t) => t || content); setPending((p) => (p.length ? p : files)); setDeep(d);
    });
  };

  // Keep the unsent draft across reloads (new-build reload, hard reset, accidental refresh).
  useEffect(() => { try { const d = sessionStorage.getItem("room.draft"); if (d) setText(d); } catch {} }, []);
  useEffect(() => { try { if (text) sessionStorage.setItem("room.draft", text); else sessionStorage.removeItem("room.draft"); } catch {} }, [text]);

  // New build live → reload automatically when nothing would be lost; otherwise offer a Reload button.
  const idleRef = useRef(true);
  idleRef.current = !anyLive && !localStreams.current && !text.trim() && !pending.length && !uploading;
  const build = useBuildWatch(() => idleRef.current);

  /**
   * Hard reset, one click: stop in-flight replies and rebuild both provider connections on the server
   * (re-reads .env.local keys, probes Iris and Claude), clear this browser's stale Room state
   * (localStorage room.* except the selected project, sessionStorage except the draft, Cache Storage,
   * service workers), then hard-reload with a cache-busting URL. The outcome is shown after the reload.
   */
  const [resetting, setResetting] = useState(false);
  const [resetNote, setResetNote] = useState<string | null>(null);
  const hardReset = async () => {
    if (resetting) return;
    setResetting(true);
    let note: string, down = false;
    try {
      const r = await api<{ providers: Record<AgentId, { ok: boolean; error?: string }>; aborted: number }>("/api/reset", { body: { abort: true } });
      const p = (a: AgentId) => `${AGENT_LABEL[a]}: ${r.providers[a].ok ? "connected" : `NOT connected (${r.providers[a].error})`}`;
      note = `Hard reset done. ${p("chatgpt")} · ${p("claude")}${r.aborted ? ` · ${r.aborted} running reply(s) stopped` : ""}.`;
    } catch (e) {
      down = isUnreachable(e);
      note = down ? "Hard reset: browser state cleared, but the Room server is unreachable (is it running? `npm run restart`). Reconnecting…"
        : `Hard reset: browser state cleared; server reset failed: ${e instanceof Error ? e.message : String(e)}`;
    }
    try { for (const k of Object.keys(localStorage)) if (k.startsWith("room.") && k !== "room.project") localStorage.removeItem(k); } catch {}
    try {
      const draft = sessionStorage.getItem("room.draft");
      sessionStorage.clear();
      if (draft) sessionStorage.setItem("room.draft", draft);
      sessionStorage.setItem("room.resetNote", note);
    } catch {}
    try { if ("caches" in window) for (const k of await caches.keys()) await caches.delete(k); } catch {}
    try { for (const reg of (await navigator.serviceWorker?.getRegistrations()) || []) await reg.unregister(); } catch {}
    if (down) { // reloading now would only show a browser error page: wait for the server instead
      try { sessionStorage.removeItem("room.resetNote"); } catch {}
      setResetNote(note); setResetting(false); reconnectRef.current(); return;
    }
    location.replace(`${location.pathname}?reset=${Date.now()}`);
  };
  useEffect(() => {
    try {
      const n = sessionStorage.getItem("room.resetNote");
      if (n) { setResetNote(n); sessionStorage.removeItem("room.resetNote"); }
    } catch {}
    if (location.search.includes("reset=")) history.replaceState(null, "", location.pathname);
  }, []);

  const msgsRef = useRef<Message[]>([]);
  msgsRef.current = state?.messages || [];
  const actions: MsgActions = useMemo(() => ({
    approve: async (m) => { await api(`/api/messages/${m.id}`, { method: "PATCH", body: { approved: !m.approved } }); reload(); },
    saveDecision: async (m) => {
      if (!pid || saved.has(m.id)) return;
      await api(`/api/projects/${pid}/decisions`, { body: { text: excerpt(m.content.replace(/[*_`#>]+/g, ""), 600), sourceMessageId: m.id } });
      setSaved((s) => new Set(s).add(m.id));
      setTab("decisions"); setBrainCollapsed(false);
      reload();
    },
    addCanon: async (m) => {
      if (!pid) return;
      const who = m.author === "human" ? "You" : AGENT_LABEL[m.author as AgentId] || "Room";
      await api(`/api/projects/${pid}/canon`, { body: { title: `${who} — ${fmtTime(m.createdAt)}`, body: m.content, priority: 2, source: `message ${m.id.slice(0, 8)}`, pinned: true } });
      const s = await api<ProjectState>(`/api/projects/${pid}`);
      setState(s);
      const created = [...s.canon].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      setEditCanonId(created?.id || null);
      setTab("canon"); setBrainCollapsed(false); setBrainSheet(true);
    },
    askOther: (m, kind, isDeep) => {
      const self = m.author as AgentId, other = OTHER[self];
      const ref = `${AGENT_LABEL[self]}’s message (${fmtTime(m.createdAt)}) beginning “${excerpt(m.content, 70)}”`;
      const content = kind === "review"
        ? `Asked ${AGENT_LABEL[other]} for a ${isDeep ? "deep review" : "review"} of ${ref}. Identify factual, continuity and quality issues and propose specific changes.`
        : `Asked ${AGENT_LABEL[other]} to implement the suggestions in ${ref}. Produce the revised work.`;
      // The review/implement request itself goes only to the other AI (explicit button). It must NOT also move the
      // route chip: that used to silently send every later message to the reviewer only, cutting the author out.
      send(content, [other], kind === "review" ? "review" : "handoff", "system", m.id, { deep: isDeep });
    },
    sendBoth: (m) => {
      const ref = `${AGENT_LABEL[m.author as AgentId]}’s message (${fmtTime(m.createdAt)}) beginning “${excerpt(m.content, 70)}”`;
      setRoute("both");
      send(`Asked both to respond to ${ref}.`, ["chatgpt", "claude"], "parallel", "system", m.id);
    },
    continueWith: (a) => { setRoute(a); document.getElementById("composer")?.focus(); },
    retry: async (m) => {
      // Re-establish both provider connections first (drops cached clients, re-reads .env.local keys),
      // then retry this reply and any sibling reply to the same prompt that also failed — a shared outage
      // takes out Claude and Iris together, so one Retry brings both back.
      try { await api("/api/reset", { body: { abort: false, probe: false } }); }
      catch (e) { if (isUnreachable(e)) { reconnectRef.current(); return; } }
      const siblings = m.status === "error"
        ? msgsRef.current.filter((x) => x.id !== m.id && x.status === "error" && x.replyToId && x.replyToId === m.replyToId && (x.author === "chatgpt" || x.author === "claude"))
        : [];
      await Promise.all([m, ...siblings].map((x) => stream(`/api/messages/${x.id}/retry`, {})));
    },
    stop: async (m) => { await api(`/api/messages/${m.id}/stop`, { body: {} }); },
  }), [pid, saved, reload, send, stream]);

  const stopAll = async () => {
    for (const m of state?.messages || []) if (m.status === "streaming") await actions.stop(m);
  };

  /** Composer attachments: uploaded now, attached to the next message sent. */
  const uploadFiles = async (files: FileList | null) => {
    if (!pid || !files?.length) return;
    setUploading(true); setErr("");
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append("file", f);
    const res = await fetch(`/api/projects/${pid}/files?forMessage=1`, { method: "POST", body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setErr(data.error || "Upload failed");
    else setPending((p) => [...p, ...data.files]);
    if (fileRef.current) fileRef.current.value = "";
    setUploading(false);
    reload();
  };
  const filesByMessage = useMemo(() => {
    const map = new Map<string, ProjectFile[]>();
    for (const f of state?.files || []) if (f.messageId) map.set(f.messageId, [...(map.get(f.messageId) || []), f]);
    return map;
  }, [state?.files]);

  useEffect(() => {
    if (!pid || !q.trim()) { setResults([]); return; }
    const t = setTimeout(() => api<Message[]>(`/api/projects/${pid}/search?q=${encodeURIComponent(q)}`).then(setResults).catch(() => {}), 250);
    return () => clearTimeout(t);
  }, [q, pid]);

  const jump = (id: string) => {
    setSearchOpen(false); stick.current = false; paneStick.current = { chatgpt: false, claude: false };
    document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(id); setTimeout(() => setFlash(null), 2000);
  };

  const createProject = async () => {
    const name = newName?.trim();
    if (!name) { setNewName(null); return; }
    const p = await api<Project>("/api/projects", { body: { name } });
    setNewName(null); await loadProjects(); setPid(p.id); setDrawer(false);
  };

  /** Last human message + all replies after it, prefixed "Name: ", for pasting into another session. */
  const latestRound = () => {
    const ms = state?.messages || [];
    let i = ms.length - 1;
    while (i >= 0 && ms[i].author !== "human") i--;
    return ms.slice(Math.max(i, 0)).filter((m) => m.author !== "system" && m.content.trim())
      .map((m) => `${m.author === "human" ? process.env.NEXT_PUBLIC_HUMAN_NAME || "Human" : NAME[m.author]}: ${m.content.trim()}`).join("\n\n");
  };

  const live = (a: AgentId) => state?.messages.find((m) => m.author === a && (m.status === "streaming" || m.status === "queued"));

  const projectList = (
    <nav aria-label="Projects" className="flex h-full flex-col gap-1 px-3 py-5">
      <div className="flex items-center gap-2.5 px-3 pb-5">
        <span className="flex gap-[3px]"><Dot className="bg-[#5B9BF0]" /><Dot className="bg-gpt" /><Dot className="bg-cl" /></span>
        <span className="flex-1 text-[15px] font-bold tracking-wide">The Room</span>
        <IconBtn label="Collapse projects" onClick={() => setLeftCollapsed(true)} className="hidden lg:flex">{Icon.left}</IconBtn>
      </div>
      <div className="px-3 pb-1.5 font-mono text-[11px] uppercase tracking-wider text-[#8893A2]">Projects</div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {projects.map((p) => (
          <button key={p.id} onClick={() => { setPid(p.id); setDrawer(false); }}
            className={`flex min-h-10 w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium ${p.id === pid ? "bg-[#1C2533] text-ink" : "text-[#B4BDC9] hover:bg-[#151C26]"}`}>
            <Dot className={p.id === pid ? "bg-[#5B9BF0]" : "bg-[#3A4658]"} />
            <span className="flex-1 truncate">{p.name}</span>
            {p.status !== "active" && <span className="font-mono text-[10px] text-mute">{p.status}</span>}
          </button>
        ))}
      </div>
      {newName !== null ? (
        <form onSubmit={(e) => { e.preventDefault(); createProject(); }} className="flex gap-1.5 px-1">
          <label htmlFor="newproj" className="sr-only">Project name</label>
          <input id="newproj" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Project name"
            className="min-w-0 flex-1 rounded-lg border border-line2 bg-panel px-2.5 py-2 text-sm outline-none focus:border-human" />
          <Btn tone="human" onClick={createProject} className="h-10">Add</Btn>
        </form>
      ) : (
        <button onClick={() => setNewName("")} className="min-h-10 rounded-lg px-3 text-left text-sm font-medium text-human hover:bg-[#151C26]">+ New project</button>
      )}
    </nav>
  );

  const brain = state && (
    <Brain state={state} tab={tab} setTab={setTab} reload={reload} onStop={actions.stop} onRetry={actions.retry}
      editCanonId={editCanonId} clearEditCanon={() => setEditCanonId(null)} />
  );

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas text-[15px] leading-normal text-ink">
      {/* Projects rail: inline on large screens, drawer otherwise */}
      <aside className="relative hidden shrink-0 border-r border-line bg-shell lg:block" style={{ width: leftCollapsed ? 56 : leftW }}>
        {leftCollapsed ? (
          <div className="flex flex-col items-center gap-3 px-2 py-4">
            <IconBtn label="Expand projects" onClick={() => setLeftCollapsed(false)}>{Icon.right}</IconBtn>
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#8893A2] [writing-mode:vertical-rl]">Projects</span>
          </div>
        ) : (
          <>
            {projectList}
            <Resizer edge="right" width={leftW} setWidth={setLeftW} min={180} max={480} onReset={() => setLeftW(LEFT_W)} label="Resize projects panel" />
          </>
        )}
      </aside>
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button aria-label="Close projects" className="absolute inset-0 bg-black/60" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-[300px] border-r border-line2 bg-shell">{projectList}</aside>
        </div>
      )}

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-8">
          <IconBtn label="Open projects" onClick={() => setDrawer(true)} className="lg:hidden">{Icon.menu}</IconBtn>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold">{state?.project.name || " "}</h1>
            <div className="flex flex-wrap gap-x-3 text-xs text-mute">
              {(["chatgpt", "claude"] as AgentId[]).map((a) => (
                <span key={a} className={live(a) ? (a === "claude" ? "text-cl-l" : "text-gpt-l") : ""}>
                  <Dot className={a === "chatgpt" ? "bg-gpt" : "bg-cl"} /> {AGENT_LABEL[a]} · {live(a) ? "working" : "ready"}
                </span>
              ))}
            </div>
          </div>
          <div role="group" aria-label="Layout" className="flex rounded-lg border border-line2 p-0.5">
            {(["thread", "split"] as const).map((v) => (
              <button key={v} aria-pressed={view === v} onClick={() => changeView(v)}
                title={v === "thread" ? "One conversation, everyone in order" : "Side by side: each agent in its own scrolling pane"}
                className={`h-9 rounded-md px-3 text-xs font-medium ${view === v ? "bg-[#1F2A3A] text-ink" : "text-[#B4BDC9] hover:bg-[#151C26]"}`}>
                {v === "thread" ? "Thread" : "Split"}
              </button>
            ))}
          </div>
          <button onClick={hardReset} disabled={resetting}
            title="Hard reset: stop running replies, reconnect Iris and Claude (re-reads API keys), clear this browser's stale Room state and reload"
            className="inline-flex h-10 items-center rounded-lg border border-[#6B2A2A] px-3 text-xs font-medium text-[#F2B8B8] hover:bg-[#241414] disabled:opacity-50">
            {resetting ? "Resetting…" : "Hard reset"}
          </button>
          <CopyBtn label="Copy latest" title="Copy your last message and every reply after it, with speaker names" text={latestRound} />
          <IconBtn label="Search conversation" onClick={() => setSearchOpen((v) => !v)}>{Icon.search}</IconBtn>
          {pid && <a href={`/api/projects/${pid}/export`} className="hidden h-10 items-center rounded-lg border border-line2 px-3 text-xs font-medium text-[#B4BDC9] hover:bg-[#1C2533] sm:inline-flex">Export .md</a>}
          <IconBtn label="Open project brain" onClick={() => setBrainSheet(true)} className="xl:hidden">{Icon.brain}</IconBtn>
        </header>

        {searchOpen && (
          <div className="border-b border-line bg-shell px-4 py-3 md:px-8">
            <label htmlFor="search" className="sr-only">Search this project</label>
            <input id="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search this project’s conversation…"
              className="w-full rounded-lg border border-line2 bg-panel px-3 py-2 text-sm outline-none focus:border-human" />
            {q && (
              <div className="mt-2 max-h-64 overflow-y-auto">
                {results.length === 0 && <p className="text-xs text-mute">No matches.</p>}
                {results.map((m) => (
                  <button key={m.id} onClick={() => jump(m.id)} className="block w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#1C2533]">
                    <span className="font-mono text-[11px] text-mute">{m.author} · {fmtTime(m.createdAt)}</span>
                    <div className="truncate text-ink2">{excerpt(m.content, 140)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {view === "split" ? (
          <section aria-label="Conversation, split by agent" className="grid min-h-0 flex-1 grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1">
            {(["chatgpt", "claude"] as AgentId[]).map((ag, idx) => {
              const msgs = (state?.messages || []).filter((m) =>
                m.author === ag || ((m.author === "human" || m.author === "system") && (m.routing?.requestedAgents?.includes(ag) ?? true)));
              const sentToOther = (m: Message) => !!m.routing?.requestedAgents?.includes("chatgpt") || !m.routing;
              return (
                <div key={ag} className={`flex min-h-0 flex-col ${idx === 0 ? "border-b border-line md:border-b-0 md:border-r" : ""}`}>
                  <div className="flex items-center gap-2 border-b border-line bg-shell px-4 py-2 text-sm font-semibold">
                    <Dot className={ag === "chatgpt" ? "bg-gpt" : "bg-cl"} />
                    <span className={ag === "chatgpt" ? "text-gpt-l" : "text-cl-l"}>{AGENT_LABEL[ag]}</span>
                    <span className="text-xs font-normal text-mute">· {live(ag) ? "working" : "ready"}</span>
                  </div>
                  <div ref={(el) => { paneRefs.current[ag] = el; }} className="min-h-0 flex-1 overflow-y-auto px-4 py-6"
                    onScroll={(e) => { const el = e.currentTarget; paneStick.current[ag] = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
                    <div className="flex flex-col gap-6">
                      {msgs.length === 0 && <p className="text-sm text-mute">No messages for {AGENT_LABEL[ag]} yet.</p>}
                      {msgs.map((m) => (
                        <MessageView key={m.id} m={m} a={actions} flash={flash === m.id} savedDecision={saved.has(m.id)} files={filesByMessage.get(m.id)}
                          anchor={ag === "chatgpt" || m.author === "claude" || !sentToOther(m)} />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </section>
        ) : (
        <section ref={scroller} aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto px-4 py-8 md:px-8"
          onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
          <div className="mx-auto flex max-w-[760px] flex-col gap-7">
            {state && state.messages.length === 0 && (
              <div className="rounded-xl border border-line p-6 text-sm text-mute">
                Start the room. Pick who answers with the chips below. Type <span className="text-human">@Iris</span> or <span className="text-human">@Claude</span> to address someone; mentioning one never drops the other.
              </div>
            )}
            {state?.messages.map((m) => <MessageView key={m.id} m={m} a={actions} flash={flash === m.id} savedDecision={saved.has(m.id)} files={filesByMessage.get(m.id)} />)}
          </div>
        </section>
        )}

        <footer className="border-t border-line px-4 pb-5 pt-3 md:px-8">
          <div className={`mx-auto flex flex-col gap-2.5 ${view === "split" ? "max-w-[1200px]" : "max-w-[760px]"}`}>
            {conn.lost && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-[#6B5A2A] bg-[#241F14] px-3 py-2 text-sm text-[#F2DDB8]">
                <span className="min-w-0 flex-1">Lost connection to the Room server — reconnecting (attempt {conn.attempt})… Replies already running keep going on the server and appear when it’s back.</span>
                <Btn onClick={() => kick.current()}>Reconnect now</Btn>
              </div>
            )}
            {resetNote && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-line2 bg-panel px-3 py-2 text-sm text-ink2">
                <span className="min-w-0 flex-1">{resetNote}</span>
                <Btn onClick={() => setResetNote(null)}>Dismiss</Btn>
              </div>
            )}
            {build.newBuild && (
              <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-[#2A4E6B] bg-[#14202A] px-3 py-2 text-sm text-[#B8DDF2]">
                <span className="min-w-0 flex-1">A new version of the Room is live. Reload to use it (your draft is kept).</span>
                <Btn onClick={() => location.reload()}>Reload now</Btn>
              </div>
            )}
            {build.stale && (
              <div role="status" className="rounded-lg border border-[#6B5A2A] bg-[#241F14] px-3 py-2 text-sm text-[#F2DDB8]">
                The server is running an older build than the one on disk (it was rebuilt without a restart). Run <code>npm run restart</code> in the project folder.
              </div>
            )}
            {err && <div className="rounded-lg border border-[#6B2A2A] bg-[#241414] px-3 py-2 text-sm text-[#F2B8B8]">{err}</div>}
            <div className="flex flex-wrap items-center gap-2">
              <div role="group" aria-label="Route to" className="flex flex-wrap gap-1.5">
                {ROUTES.map((r) => (
                  <button key={r.id} aria-pressed={route === r.id} onClick={() => setRoute(r.id)}
                    className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium ${route === r.id ? "border-[#5B9BF0] bg-[#1F2A3A] text-ink" : "border-line2 text-[#B4BDC9]"}`}>
                    <Dot className={r.dot} />{r.label}
                  </button>
                ))}
              </div>
              <button aria-pressed={deep} onClick={() => setDeep((v) => !v)} title="Use each agent’s Deep model for this one message"
                className={`inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-medium ${deep ? "border-[#B07CE8] bg-[#251B33] text-[#DCC4F7]" : "border-line2 text-[#B4BDC9]"}`}>
                Deep
              </button>
              <span className="text-xs text-mute">{(() => {
                const addressed = parseMentions(text), to = union(agentsFor(route), addressed);
                const names = (xs: AgentId[]) => xs.map((a) => AGENT_LABEL[a]).join(" and ");
                if (deep) return `Deep models for this message: ${to.map((a) => state?.project.deepModels[a]).join(" + ")}`;
                if (addressed.length) return `Addressed to ${names(addressed)}. ${to.length > 1 ? "Iris and Claude both receive it and both reply." : `Only ${names(to)} replies (chip).`}`;
                return HINT[route];
              })()}</span>
            </div>
            <div className="rounded-2xl border border-line2 bg-panel p-3">
              <label htmlFor="composer" className="sr-only">Message the room</label>
              <textarea id="composer" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the room… (paste or drop screenshots/files here)"
                onPaste={(e) => { const fl = e.clipboardData?.files; if (fl && fl.length) { e.preventDefault(); uploadFiles(fl); } }}
                onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
                onDrop={(e) => { const fl = e.dataTransfer?.files; if (fl && fl.length) { e.preventDefault(); uploadFiles(fl); } }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
                className="max-h-60 w-full resize-y bg-transparent px-1.5 py-1 text-[15px] text-ink outline-none" />
              {(pending.length > 0 || uploading) && (
                <div className="mt-1 flex flex-wrap gap-1.5 px-1">
                  {pending.map((f) => (
                    <span key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line2 px-2 py-1 font-mono text-[11px] text-ink2">
                      {f.name}{f.note ? <span className="text-mute">· {f.note}</span> : null}
                      <button aria-label={`Remove ${f.name}`} className="text-mute hover:text-ink" onClick={async () => {
                        setPending((p) => p.filter((x) => x.id !== f.id));
                        await api(`/api/files/${f.id}`, { method: "DELETE" }); reload();
                      }}>×</button>
                    </span>
                  ))}
                  {uploading && <span className="font-mono text-[11px] text-mute">Uploading… (videos take a while: frames + transcript)</span>}
                </div>
              )}
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="flex gap-2">
                  <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
                  <IconBtn label="Attach images, PDFs, video or text" onClick={() => fileRef.current?.click()}>{Icon.clip}</IconBtn>
                </div>
                <div className="flex gap-2">
                  {anyLive && <Btn className="h-10" onClick={stopAll}>Stop</Btn>}
                  <button onClick={submit} disabled={(!text.trim() && !pending.length) || !pid || uploading}
                    className="h-10 rounded-xl bg-human-d px-5 text-sm font-semibold text-white disabled:opacity-40">Send</button>
                </div>
              </div>
            </div>
          </div>
        </footer>
      </main>

      {/* Project Brain: inline + collapsible on wide screens, slide-over otherwise */}
      <aside aria-label="Project brain" className="relative hidden shrink-0 border-l border-line bg-shell xl:flex xl:flex-col" style={{ width: brainCollapsed ? 56 : rightW }}>
        {!brainCollapsed && <Resizer edge="left" width={rightW} setWidth={setRightW} min={260} max={720} onReset={() => setRightW(RIGHT_W)} label="Resize project brain" />}
        {brainCollapsed ? (
          <div className="flex flex-col items-center gap-3 px-2 py-4">
            <IconBtn label="Expand project brain" onClick={() => setBrainCollapsed(false)}>{Icon.left}</IconBtn>
            <span className="font-mono text-[11px] uppercase tracking-wider text-[#8893A2] [writing-mode:vertical-rl]">Project brain</span>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#8893A2]">Project brain</span>
              <IconBtn label="Collapse project brain" onClick={() => setBrainCollapsed(true)}>{Icon.right}</IconBtn>
            </div>
            <div className="min-h-0 flex-1">{brain}</div>
          </>
        )}
      </aside>
      {brainSheet && (
        <div className="fixed inset-0 z-40 xl:hidden">
          <button aria-label="Close project brain" className="absolute inset-0 bg-black/60" onClick={() => setBrainSheet(false)} />
          <aside className="absolute inset-y-0 right-0 flex w-[min(380px,92vw)] flex-col border-l border-line2 bg-shell">
            <div className="flex items-center justify-between px-4 pt-3">
              <span className="font-mono text-[11px] uppercase tracking-wider text-[#8893A2]">Project brain</span>
              <IconBtn label="Close project brain" onClick={() => setBrainSheet(false)}>{Icon.close}</IconBtn>
            </div>
            <div className="min-h-0 flex-1">{brain}</div>
          </aside>
        </div>
      )}
    </div>
  );
}
