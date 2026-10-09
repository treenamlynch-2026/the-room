import fs from "node:fs";
import { contextFiles, getState, messageFiles, type FileRow } from "./db";
import { fileParts } from "./media";
import type { AgentId, AgentRequest, Message, Part, Turn } from "./types";

export const AGENT_NAME: Record<AgentId, string> = { chatgpt: "Iris", claude: "Claude" };
export const HUMAN_NAME = () => process.env.HUMAN_NAME || "Human";
const RECENT_WINDOW = () => Number(process.env.RECENT_WINDOW) || 30;
/** Message attachments (images, PDFs, video frames) are re-sent only while their message is this recent. */
const MEDIA_WINDOW = () => Number(process.env.MEDIA_WINDOW) || 6;

const MAX_FILE_CHARS = 60_000;
const MAX_FILES_CHARS = 200_000;

/** Layer A — global room rules. */
function roomRules(self: AgentId): string {
  const other: AgentId = self === "claude" ? "chatgpt" : "claude";
  const human = HUMAN_NAME();
  return `# Room rules
You are ${AGENT_NAME[self]}, one of two AI collaborators in a shared project room. The other participants are ${human} (the human director) and ${AGENT_NAME[other]} (another AI).
- Every participant's message appears in the conversation prefixed with [Name]. Your own earlier replies appear as your assistant turns.
- ${human} controls routing. Answer only as yourself. Never write lines for ${AGENT_NAME[other]} or ${human}.
- A header like "[${human} → ${AGENT_NAME.chatgpt} and ${AGENT_NAME.claude} · addressed to ${AGENT_NAME[other]}]" means ${human} named ${AGENT_NAME[other]} (@mention) but sent it to both of you. You are still in the conversation: let ${AGENT_NAME[other]} answer what was asked of them, and add your own view, corrections or a short acknowledgement. Do not answer on their behalf.
- When asked to review the other AI's work, be specific: name the issue, why it matters, and the fix.
- Messages marked "approved" were accepted by ${human}, Claude or Iris (the header says who). Unmarked AI messages are suggestions, not facts.
- Label any claim you have not verified as unverified.
- Files arrive labeled [File: name]. Images, PDFs and video frames are real content you can see; refer to them by file name (and timestamp for video).

# Authority order (highest first)
1. ${human}'s current instruction
2. Project Canon
3. Approved Decisions
4. Project files / source material
5. Recent conversation
6. AI-generated historical suggestions

If a request conflicts with a higher-priority item, do NOT silently pick one. State the conflict in one or two sentences, name the canon entry or decision it conflicts with, and ask whether to proceed with the new instruction anyway. ${human} is the final authority.

# Saving and approving
${human}, Claude and Iris can all approve messages, save Decisions and add to Canon. ${human} can overrule or remove any of them. To act, put a directive on its own line in your reply; the room executes it and replaces it with a receipt:
- [[APPROVE]] approves ${AGENT_NAME[other]}'s message you are responding to. You cannot approve your own messages.
- [[DECISION: one-sentence decision]] saves a Decision.
- [[CANON: Title]] on one line, the body on the following lines, then [[/CANON]] adds an active Canon entry.
Use these only when ${human} asks, or when something was clearly agreed and is worth keeping. Never save unverified claims. Saved entries are sent with every future call, so keep them short.`;
}

function header(m: Message, self: AgentId): { role: Turn["role"]; head: string } | null {
  if (m.author === self) return { role: "assistant", head: "" };
  if (m.author === "chatgpt" || m.author === "claude") {
    if (m.status === "error") return null;
    return { role: "user", head: m.approved ? `[${AGENT_NAME[m.author]} — approved by ${m.approvedBy || HUMAN_NAME()}]` : `[${AGENT_NAME[m.author]} — suggestion]` };
  }
  if (m.author === "system") return { role: "user", head: "[Room]" };
  const to = m.routing?.requestedAgents?.map((a) => AGENT_NAME[a]).join(" and ");
  const addr = m.routing?.addressed?.length ? ` · addressed to ${m.routing.addressed.map((a) => AGENT_NAME[a]).join(" and ")}` : "";
  return { role: "user", head: `[${HUMAN_NAME()}${to ? ` → ${to}` : ""}${addr}]` };
}

/**
 * Build the layered context for one agent.
 * `history` must already be cut at the dispatch point, so parallel replies never see each other.
 */
export function buildRequest(projectId: string, self: AgentId, history: Message[], signal: AbortSignal, model?: string): AgentRequest {
  const state = getState(projectId)!;
  const { project, canon, decisions } = state;
  const parts: string[] = [roomRules(self)];

  // Layer B — canon
  const active = canon.filter((c) => c.active).sort((a, b) => a.priority - b.priority);
  if (active.length)
    parts.push("# Project Canon (authoritative)\n" + active.map((c) => `## [P${c.priority}] ${c.title}${c.source ? ` (source: ${c.source})` : ""}\n${c.body}`).join("\n\n"));

  // Layer C — decisions
  if (decisions.length) parts.push("# Approved Decisions\n" + decisions.map((d) => `- ${d.text}`).join("\n"));

  // Layer D — pinned project files. Text goes in the system prompt; media goes in a reference turn.
  const pinned = contextFiles(projectId);
  const textFiles = pinned.filter((f) => f.kind === "text");
  const mediaFiles = pinned.filter((f) => f.kind !== "text");
  if (textFiles.length) {
    let budget = MAX_FILES_CHARS;
    const blocks = textFiles.map((f) => {
      let text = "";
      try { text = fs.readFileSync(f.stored_path, "utf8"); } catch { return `### ${f.name}\n(unreadable)`; }
      const take = Math.max(0, Math.min(text.length, MAX_FILE_CHARS, budget));
      budget -= take;
      return `### ${f.name}\n\`\`\`\n${text.slice(0, take)}\n\`\`\`${take < text.length ? "\n(truncated)" : ""}`;
    });
    parts.push("# Project files (source material)\n" + blocks.join("\n\n"));
  }

  // Layer F — summary, then Layer E — recent window
  let rest = history;
  if (project.summaryThroughId) {
    const idx = history.findIndex((m) => m.id === project.summaryThroughId);
    if (idx >= 0) rest = history.slice(idx + 1);
  }
  if (project.conversationSummary) parts.push("# Summary of earlier conversation\n" + project.conversationSummary);
  const win = RECENT_WINDOW();
  if (rest.length > win) {
    parts.push(`(${rest.length - win} older messages are not shown and not yet summarized.)`);
    rest = rest.slice(-win);
  }

  const turns: Turn[] = [];
  if (mediaFiles.length) {
    const ref: Part[] = [{ type: "text", text: `[Project reference files pinned by ${HUMAN_NAME()}]` }, ...mediaFiles.flatMap(fileParts)];
    ref[ref.length - 1] = { ...ref[ref.length - 1], cache: true }; // stable prefix: cacheable
    turns.push({ role: "user", content: ref });
  }

  const attached = new Map<string, FileRow[]>();
  for (const f of messageFiles(projectId)) attached.set(f.message_id!, [...(attached.get(f.message_id!) || []), f]);
  const mediaFrom = rest.length - MEDIA_WINDOW();

  rest.forEach((m, i) => {
    const h = header(m, self);
    if (!h) return;
    const files = (attached.get(m.id) || []).filter((f) => !f.in_context); // pinned ones are already in the reference turn
    const body = h.head ? `${h.head}\n${m.content}` : m.content;
    if (!files.length) { if (m.content.trim()) turns.push({ role: h.role, content: body }); return; }
    const p: Part[] = [{ type: "text", text: body || h.head }];
    for (const f of files) {
      if (f.kind === "text") {
        let t = ""; try { t = fs.readFileSync(f.stored_path, "utf8").slice(0, MAX_FILE_CHARS); } catch {}
        p.push({ type: "text", text: `[File: ${f.name}]\n\`\`\`\n${t}\n\`\`\`` });
      } else if (i >= mediaFrom) p.push(...fileParts(f));
      else p.push({ type: "text", text: `[File: ${f.name} — shown earlier, no longer attached]` });
    }
    turns.push({ role: h.role, content: p });
  });

  return { model: model || project.models[self], system: parts.join("\n\n"), turns, signal };
}
