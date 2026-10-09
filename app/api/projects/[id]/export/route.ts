import { getState } from "@/lib/db";
import { AGENT_NAME, HUMAN_NAME } from "@/lib/context";
import { bad, type Ctx } from "@/lib/http";

export async function GET(_: Request, { params }: Ctx) {
  const s = getState((await params).id);
  if (!s) return bad("not found", 404);
  const who = (a: string) => (a === "human" ? HUMAN_NAME() : a === "system" ? "Room" : AGENT_NAME[a as "claude"]);
  const md = [
    `# ${s.project.name}`, s.project.description || "", `Exported ${new Date().toISOString()}`,
    "## Canon", ...s.canon.map((c) => `### [P${c.priority}] ${c.title}${c.active ? "" : " (inactive)"}\n${c.body}${c.source ? `\n\nSource: ${c.source}` : ""}`),
    "## Decisions", ...s.decisions.map((d) => `- ${d.text}`),
    "## Files", ...s.files.map((f) => `- ${f.name}${f.inContext ? "" : " (excluded from context)"}`),
    ...(s.project.conversationSummary ? ["## Conversation summary", s.project.conversationSummary] : []),
    "## Conversation",
    ...s.messages.map((m) => `### ${who(m.author)} — ${m.createdAt}${m.model ? ` · ${m.model}` : ""}${m.approved ? " · approved" : ""}\n\n${m.content}`),
  ].join("\n\n");
  const name = s.project.name.replace(/[^\w-]+/g, "-").toLowerCase();
  return new Response(md, { headers: { "Content-Type": "text/markdown; charset=utf-8", "Content-Disposition": `attachment; filename="${name}.md"` } });
}
