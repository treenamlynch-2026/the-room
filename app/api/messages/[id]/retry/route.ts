import { getMessage } from "@/lib/db";
import { bad, type Ctx } from "@/lib/http";
import { runAgents, running } from "@/lib/run";

export async function POST(_: Request, { params }: Ctx) {
  const msg = getMessage((await params).id);
  if (!msg || (msg.author !== "chatgpt" && msg.author !== "claude")) return bad("not an AI message");
  if (running.has(msg.id)) return bad("still running", 409);
  const trigger = msg.replyToId ? getMessage(msg.replyToId) : null;
  if (!trigger) return bad("original prompt not found");
  return runAgents(msg.projectId, trigger, [{ agent: msg.author, messageId: msg.id }], msg.routing?.mode || "single", [], !!msg.routing?.deep);
}
