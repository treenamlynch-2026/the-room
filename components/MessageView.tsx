"use client";
import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentId, Message, ProjectFile } from "@/lib/types";
import { AGENT_LABEL, Btn, CopyBtn, Icon, NAME, OTHER, accent, fmtTime } from "./ui";

export type MsgActions = {
  approve: (m: Message) => void;
  saveDecision: (m: Message) => void;
  addCanon: (m: Message) => void;
  askOther: (m: Message, kind: "review" | "implement", deep?: boolean) => void;
  sendBoth: (m: Message) => void;
  continueWith: (a: AgentId) => void;
  retry: (m: Message) => void;
  stop: (m: Message) => void;
};

const Markdown = memo(function Markdown({ text }: { text: string }) {
  return <div className="md"><ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown></div>;
});

const JOB: Record<string, string> = { review: "reviewing", handoff: "implementing", parallel: "responding", single: "responding" };

function Attachments({ files }: { files?: ProjectFile[] }) {
  if (!files?.length) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer"
          className="flex max-w-[220px] flex-col gap-1 overflow-hidden rounded-lg border border-line2 bg-card hover:border-human">
          {f.kind === "image" && <img src={`/api/files/${f.id}`} alt={f.name} className="h-28 w-full object-cover" />}
          <span className="truncate px-2 pb-1.5 pt-1 font-mono text-[11px] text-ink2">{f.name}{f.note && f.kind !== "image" ? ` · ${f.note}` : ""}</span>
        </a>
      ))}
    </div>
  );
}

export function MessageView({ m, a, flash, savedDecision, files, anchor = true }: { m: Message; a: MsgActions; flash?: boolean; savedDecision?: boolean; files?: ProjectFile[]; anchor?: boolean }) {
  const domId = anchor ? `m-${m.id}` : undefined;
  const ac = accent[m.author];
  const isAI = m.author === "chatgpt" || m.author === "claude";
  const live = m.status === "streaming" || m.status === "queued";
  const to = m.routing?.requestedAgents;
  const meta = isAI
    ? [fmtTime(m.createdAt), m.model, m.routing?.deep ? "deep" : null, m.routing?.mode, m.usage ? `${m.usage.inputTokens}→${m.usage.outputTokens} tok` : null]
    : [fmtTime(m.createdAt), to?.length ? `to ${to.length > 1 ? "both" : AGENT_LABEL[to[0]]}` : null,
       m.routing?.addressed?.length ? `addressed @${m.routing.addressed.map((x) => AGENT_LABEL[x]).join(" @")}` : null, m.routing?.deep ? "deep" : null];

  if (m.author === "system") {
    return (
      <div id={domId} className={`rounded-lg border border-line px-3 py-2 text-[13px] text-mute ${flash ? "ring-2 ring-human" : ""}`}>
        <span className="font-mono text-[11px] uppercase tracking-wider">Routed · {fmtTime(m.createdAt)}</span>
        <div>{m.content}</div>
        <Attachments files={files} />
      </div>
    );
  }

  return (
    <article id={domId} className={`flex gap-3.5 rounded-xl ${flash ? "ring-2 ring-human ring-offset-4 ring-offset-canvas" : ""}`}>
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[13px] font-bold ${ac.bg} ${ac.text}`}>{ac.letter}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2.5">
          <strong className={`text-sm ${ac.text}`}>{NAME[m.author]}</strong>
          <span className="font-mono text-[11px] text-[#8893A2]">{meta.filter(Boolean).join(" · ")}</span>
        </div>
        {isAI && !live && m.status !== "error" && (
          <span className={`mt-1 inline-block rounded-md px-1.5 py-0.5 font-mono text-[11px] ${m.approved ? "bg-[#10251F] text-gpt-l" : "bg-[#1F2A3A] text-[#B7D3FA]"}`}>
            {m.approved ? `approved${m.approvedBy ? ` by ${m.approvedBy}` : ""}` : "AI suggestion · not approved"}
          </span>
        )}
        <div className="mt-1.5 text-[15px] text-ink">
          {m.content ? <Markdown text={m.content} /> : live ? null : <span className="text-mute">(no content)</span>}
        </div>
        <Attachments files={files} />
        {live && (
          <div className="mt-2 flex items-center gap-3">
            <span className={`typing ${m.author === "chatgpt" ? "gpt" : ""}`} aria-label="Working"><span /><span /><span /></span>
            <span className="text-sm text-[#B4BDC9]">Working… {JOB[m.routing?.mode || "single"]}</span>
            <Btn onClick={() => a.stop(m)}>Stop</Btn>
          </div>
        )}
        {m.status === "error" && (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-[#6B2A2A] bg-[#241414] px-3 py-2 text-sm text-[#F2B8B8]">
            <span className="min-w-0 flex-1">Failed: {m.error || "unknown error"}</span>
            <Btn onClick={() => a.retry(m)}>Retry</Btn>
          </div>
        )}
        {m.status === "stopped" && <div className="mt-1 font-mono text-[11px] text-mute">stopped</div>}
        {!live && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {isAI && (
              <Btn tone={m.approved ? "ok" : ""} onClick={() => a.approve(m)}>{Icon.thumb}{m.approved ? "Approved" : "Approve"}</Btn>
            )}
            <Btn tone={savedDecision ? "ok" : ""} onClick={() => a.saveDecision(m)}>{savedDecision ? "Saved ✓" : "Save as Decision"}</Btn>
            <Btn onClick={() => a.addCanon(m)}>Add to Canon</Btn>
            {isAI && (() => {
              const self = m.author as AgentId, other = OTHER[self];
              const t = other === "chatgpt" ? "gpt" : "cl";
              return (
                <>
                  <span className="mx-0.5 w-px self-stretch bg-line2" />
                  <Btn tone={t} onClick={() => a.askOther(m, "review")}>Ask {AGENT_LABEL[other]} to review</Btn>
                  <Btn tone={t} onClick={() => a.askOther(m, "review", true)} title={`Uses ${AGENT_LABEL[other]}’s Deep model`}>Deep review</Btn>
                  <Btn tone={t} onClick={() => a.askOther(m, "implement")}>Ask {AGENT_LABEL[other]} to implement</Btn>
                  <Btn onClick={() => a.sendBoth(m)}>Send to both</Btn>
                  <Btn tone={self === "chatgpt" ? "gpt" : "cl"} onClick={() => a.continueWith(self)}>Continue with {AGENT_LABEL[self]}</Btn>
                  <span className="mx-0.5 w-px self-stretch bg-line2" />
                  <Btn onClick={() => a.retry(m)}>Retry</Btn>
                </>
              );
            })()}
            <CopyBtn text={m.content} title="Copy this whole message" />
          </div>
        )}
      </div>
    </article>
  );
}
