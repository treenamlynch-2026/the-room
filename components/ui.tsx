"use client";
import { useState } from "react";
import type { AgentId, Author } from "@/lib/types";

// Display names only. Internal ids stay "chatgpt" / "claude" (DB rows, API, routing).
export const NAME: Record<Author, string> = { human: "You", chatgpt: "Iris", claude: "Claude", system: "Room" };
export const OTHER: Record<AgentId, AgentId> = { chatgpt: "claude", claude: "chatgpt" };
export const AGENT_LABEL: Record<AgentId, string> = { chatgpt: "Iris", claude: "Claude" };

/** Clipboard write with a fallback for browsers/contexts where navigator.clipboard is unavailable. */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch { return false; }
}

/** Copy button with visible confirmation. */
export function CopyBtn({ text, label = "Copy", title }: { text: string | (() => string); label?: string; title?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "fail">("idle");
  return (
    <Btn title={title} tone={state === "ok" ? "ok" : ""} onClick={async () => {
      const ok = await copyText(typeof text === "function" ? text() : text);
      setState(ok ? "ok" : "fail"); setTimeout(() => setState("idle"), 1500);
    }}>{state === "ok" ? "Copied ✓" : state === "fail" ? "Copy failed" : label}</Btn>
  );
}

/** Drag handle on a panel edge. edge="right" grows when dragged right; edge="left" grows when dragged left. */
export function Resizer({ edge, width, setWidth, min, max, onReset, label }: {
  edge: "left" | "right"; width: number; setWidth: (w: number) => void; min: number; max: number; onReset: () => void; label: string;
}) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX, startW = width;
    const move = (ev: PointerEvent) => {
      const d = ev.clientX - startX;
      setWidth(Math.min(max, Math.max(min, startW + (edge === "right" ? d : -d))));
    };
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      document.body.style.cursor = ""; document.body.style.userSelect = "";
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
  };
  return (
    <div role="separator" aria-orientation="vertical" aria-label={label} title="Drag to resize · double-click to reset"
      onPointerDown={down} onDoubleClick={onReset}
      className={`absolute inset-y-0 z-20 w-2 cursor-col-resize hover:bg-[#5B9BF0]/40 ${edge === "right" ? "-right-1" : "-left-1"}`} />
  );
}

export const accent = {
  human: { text: "text-human", bg: "bg-[#1B2B44]", dot: "bg-human", letter: "Y" },
  chatgpt: { text: "text-gpt", bg: "bg-[#123630]", dot: "bg-gpt", letter: "I" },
  claude: { text: "text-cl", bg: "bg-[#3A2A14]", dot: "bg-cl", letter: "C" },
  system: { text: "text-mute", bg: "bg-card", dot: "bg-mute", letter: "R" },
} as const;

export function Dot({ className = "" }: { className?: string }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${className}`} />;
}

export function Btn({ children, onClick, tone = "", disabled, title, className = "" }: {
  children: React.ReactNode; onClick?: () => void; tone?: "" | "gpt" | "cl" | "human" | "ok"; disabled?: boolean; title?: string; className?: string;
}) {
  const tones = {
    "": "text-[#B4BDC9] border-line2",
    gpt: "text-gpt-l border-[#1E4A42]",
    cl: "text-cl-l border-[#5A3F1C]",
    human: "text-human border-[#263C5E]",
    ok: "text-gpt-l border-[#1E4A42] bg-[#10251F]",
  } as const;
  return (
    <button type="button" title={title} disabled={disabled} onClick={onClick}
      className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 text-xs font-medium hover:bg-[#1C2533] hover:text-ink disabled:opacity-40 ${tones[tone]} ${className}`}>
      {children}
    </button>
  );
}

export function IconBtn({ label, onClick, children, className = "" }: { label: string; onClick?: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-line2 text-ink2 hover:bg-[#1C2533] ${className}`}>
      {children}
    </button>
  );
}

export const Icon = {
  menu: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>,
  brain: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>,
  search: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>,
  close: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  left: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>,
  right: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>,
  thumb: <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 10v11H3V10h4zM7 10l4-8a3 3 0 0 1 3 3v4h6a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21H7" /></svg>,
  clip: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11l-8.5 8.5a5 5 0 0 1-7-7L14 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L15 7" /></svg>,
};

export function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={`inline-flex h-8 items-center gap-2 rounded-lg border border-line2 px-2 text-xs font-medium ${on ? "text-ink" : "text-mute"}`}>
      <span className={`relative h-3.5 w-6 rounded-full ${on ? "bg-[#2C6BD1]" : "bg-line2"}`}>
        <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full ${on ? "left-3 bg-white" : "left-0.5 bg-[#8893A2]"}`} />
      </span>
      {label}
    </button>
  );
}

export const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const excerpt = (s: string, n = 80) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
