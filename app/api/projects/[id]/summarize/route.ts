import { complete } from "@/lib/agents/adapters";
import { AGENT_NAME, HUMAN_NAME } from "@/lib/context";
import { getState, updateProject } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";

/** Compress everything older than the recent window into the project summary (Layer F). Uses Claude. */
export async function POST(_: Request, { params }: Ctx) {
  const id = (await params).id;
  const s = getState(id);
  if (!s) return bad("not found", 404);
  const keep = Number(process.env.RECENT_WINDOW) || 30;
  let msgs = s.messages;
  const from = s.project.summaryThroughId ? msgs.findIndex((m) => m.id === s.project.summaryThroughId) + 1 : 0;
  msgs = msgs.slice(from, Math.max(from, msgs.length - keep));
  if (!msgs.length) return bad("Nothing older than the recent window to summarize yet.");
  const who = (a: string) => (a === "human" ? HUMAN_NAME() : a === "system" ? "Room" : AGENT_NAME[a as "claude"]);
  const transcript = msgs.filter((m) => m.content.trim()).map((m) => `[${who(m.author)}${m.approved ? ", approved" : ""}] ${m.content}`).join("\n\n");
  try {
    const summary = await complete("claude", {
      model: s.project.models.claude,
      system: "You compress project conversations into a running summary for later AI context. Keep: what was asked, what was produced, what the human approved or rejected, open questions. Mark AI suggestions that were never approved as suggestions. Be concise; use short bullet points.",
      turns: [{ role: "user", content: `Existing summary:\n${s.project.conversationSummary || "(none)"}\n\nNew conversation to fold in:\n${transcript}\n\nReturn the full updated summary only.` }],
      signal: AbortSignal.timeout(120_000),
    });
    updateProject(id, { conversationSummary: summary, summaryThroughId: msgs[msgs.length - 1].id });
    return json(getState(id));
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 502);
  }
}
