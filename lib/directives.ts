import { createCanon, createDecision, getMessage, updateMessage } from "./db";
import type { AgentId, Message } from "./types";

/**
 * AI save/approve actions, written by the model as directive lines in its reply:
 *   [[APPROVE]]                         approve the other AI's message this reply answers
 *   [[DECISION: text]]                  save a Decision
 *   [[CANON: Title]] ...body... [[/CANON]]  add an active Canon entry (body may span lines)
 * Directives are stripped from the stored reply and replaced by a short receipt.
 */
const NAME: Record<AgentId, string> = { chatgpt: "Iris", claude: "Claude" };

export function applyDirectives(projectId: string, self: AgentId, msg: Message, trigger: Message, history: Message[], text: string): string {
  const other: AgentId = self === "claude" ? "chatgpt" : "claude";
  const done: string[] = [];
  let out = text;

  out = out.replace(/\[\[CANON:\s*([^\]\n]+?)\s*\]\]\s*\n?([\s\S]*?)\[\[\/CANON\]\]/g, (_, title: string, body: string) => {
    const b = body.trim();
    if (b) {
      createCanon(projectId, { title: title.trim(), body: b, priority: 2, source: `saved by ${NAME[self]} (message ${msg.id.slice(0, 8)})`, pinned: true });
      done.push(`Canon “${title.trim()}”`);
    }
    return "";
  });

  out = out.replace(/\[\[DECISION:\s*([\s\S]+?)\s*\]\]/g, (_, t: string) => {
    createDecision(projectId, t.trim(), msg.id);
    done.push(`Decision “${t.trim().slice(0, 80)}”`);
    return "";
  });

  out = out.replace(/\[\[APPROVE\]\]/g, () => {
    let target = trigger.replyToId ? getMessage(trigger.replyToId) : null;
    if (!target || target.author !== other) target = [...history].reverse().find((m) => m.author === other && m.status === "complete") || null;
    if (target && target.author === other) {
      updateMessage(target.id, { approved: true, approvedBy: NAME[self] });
      done.push(`approved ${NAME[other]}’s message (${target.id.slice(0, 8)})`);
    }
    return "";
  });

  out = out.replace(/\n{3,}/g, "\n\n").trim();
  if (done.length) out += `\n\n---\n*${NAME[self]} saved: ${done.join("; ")}.*`;
  return out;
}
