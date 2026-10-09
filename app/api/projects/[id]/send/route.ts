import { attachFilesToMessage, getMessage, getProject, insertMessage } from "@/lib/db";
import { bad, type Ctx } from "@/lib/http";
import { runAgents } from "@/lib/run";
import type { AgentId, RoutingMode } from "@/lib/types";

export async function POST(req: Request, { params }: Ctx) {
  const projectId = (await params).id;
  if (!getProject(projectId)) return bad("not found", 404);
  const body = await req.json();
  const isAgent = (a: unknown): a is AgentId => a === "chatgpt" || a === "claude";
  const addressed: AgentId[] = Array.isArray(body.addressed) ? [...new Set<AgentId>(body.addressed.filter(isAgent))] : [];
  // An @mention adds the addressed AI as a recipient; it can never remove one.
  const agents: AgentId[] = [...new Set<AgentId>([...(body.agents || []).filter(isAgent), ...addressed])];
  const content: string = (body.content || "").trim();
  if (!agents.length) return bad("no agents");
  if (!content) return bad("empty message");
  const mode: RoutingMode = body.mode || (agents.length > 1 ? "parallel" : "single");
  const deep = !!body.deep;
  const created = insertMessage({
    projectId, author: body.author === "system" ? "system" : "human", content,
    replyToId: body.replyToId ?? null, routing: { requestedAgents: agents, mode, deep, ...(addressed.length ? { addressed } : {}) }, status: "complete",
  });
  if (Array.isArray(body.fileIds) && body.fileIds.length) attachFilesToMessage(projectId, created.id, body.fileIds);
  const trigger = getMessage(created.id)!;
  return runAgents(projectId, trigger, agents.map((agent) => ({ agent })), mode, [trigger], deep);
}
