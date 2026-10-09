import { adapters } from "./agents/adapters";
import { buildRequest } from "./context";
import { applyDirectives } from "./directives";
import { getMessage, getProject, insertMessage, listMessages, updateMessage } from "./db";
import type { AgentId, Message, RoutingMode, StreamEvent } from "./types";

/** In-flight generations, so the Stop button can abort them by message id. */
const g = globalThis as unknown as { __roomRuns?: Map<string, AbortController> };
export const running = g.__roomRuns ?? new Map<string, AbortController>();
g.__roomRuns = running;

type Job = { agent: AgentId; messageId?: string };

const MAX_ATTEMPTS = Number(process.env.AGENT_MAX_ATTEMPTS) || 4; // 1 try + 3 retries (on top of the SDK's own retries)
const BACKOFF_BASE_MS = 1500, BACKOFF_CAP_MS = 15_000;
const sleep = (ms: number, signal: AbortSignal) => new Promise<void>((r) => {
  const t = setTimeout(r, ms);
  signal.addEventListener("abort", () => { clearTimeout(t); r(); }, { once: true });
});
const log = (agent: AgentId, id: string, s: string) => console.log(`[room] ${new Date().toISOString()} ${agent} ${id.slice(0, 8)} ${s}`);

/**
 * Run one or more agents against a trigger message and stream progress as SSE.
 * Every agent gets history cut at the trigger message, so parallel replies never see each other.
 * Generation continues and is persisted even if the browser disconnects.
 */
export function runAgents(projectId: string, trigger: Message, jobs: Job[], mode: RoutingMode, preface: Message[] = [], deep = false): Response {
  const enc = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: StreamEvent) => {
        if (closed) return;
        try { controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); } catch { closed = true; }
      };
      for (const m of preface) emit({ type: "message", message: m });

      const all = listMessages(projectId);
      const history = all.slice(0, all.findIndex((m) => m.id === trigger.id) + 1);
      const project = getProject(projectId)!;
      const requested = jobs.map((j) => j.agent);

      await Promise.all(jobs.map(async (job) => {
        const ac = new AbortController();
        const model = (deep ? project.deepModels : project.models)[job.agent];
        let msg: Message;
        if (job.messageId) {
          updateMessage(job.messageId, { content: "", status: "streaming", error: null, usage: null, model, approved: false, approvedBy: null });
          msg = getMessage(job.messageId)!;
        } else {
          msg = insertMessage({ projectId, author: job.agent, content: "", replyToId: trigger.id,
            routing: { requestedAgents: requested, mode, deep }, status: "streaming", model });
        }
        emit({ type: "message", message: { ...msg, content: "", status: "streaming", error: null, usage: null } });
        running.set(msg.id, ac);

        const req = buildRequest(projectId, job.agent, history.filter((m) => m.id !== msg.id), ac.signal, model);
        let text = "", lastSave = Date.now(), ended = false;
        try {
          // Transient failures (dropped connection, 429, 5xx, overloaded) are retried with exponential backoff
          // instead of surfacing immediately. Partial text from a failed attempt is discarded and the reply restarts.
          for (let attempt = 0; attempt < MAX_ATTEMPTS && !ended && !ac.signal.aborted; attempt++) {
            let retry: string | null = null;
            for await (const ev of adapters[job.agent].send(req)) {
              if (ev.type === "delta") {
                text += ev.text;
                emit({ type: "delta", id: msg.id, text: ev.text });
                if (Date.now() - lastSave > 750) { updateMessage(msg.id, { content: text }); lastSave = Date.now(); }
              } else if (ev.type === "done") {
                let final = text;
                try { final = applyDirectives(projectId, job.agent, msg, trigger, history, text); } catch (e) { console.error("directives", e); }
                updateMessage(msg.id, { content: final, status: "complete", usage: ev.usage ?? null, model: ev.model ?? model });
                if (final !== text) emit({ type: "message", message: getMessage(msg.id)! });
                emit({ type: "status", id: msg.id, status: "complete", usage: ev.usage ?? null, model: ev.model ?? model });
                ended = true;
              } else if (ev.type === "error") {
                log(job.agent, msg.id, `error (attempt ${attempt + 1}/${MAX_ATTEMPTS}, retryable=${!!ev.retryable}): ${ev.message}`);
                if (ev.retryable && attempt + 1 < MAX_ATTEMPTS) { retry = ev.message; break; }
                const error = attempt ? `${ev.message} (after ${attempt + 1} attempts)` : ev.message;
                updateMessage(msg.id, { content: text, status: "error", error });
                emit({ type: "status", id: msg.id, status: "error", error });
                ended = true;
              }
            }
            if (ended || ac.signal.aborted || attempt + 1 >= MAX_ATTEMPTS) break;
            const wait = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt) + Math.floor(Math.random() * 400);
            log(job.agent, msg.id, `retrying in ${wait}ms after: ${retry ?? "stream ended without a result"}`);
            text = "";
            updateMessage(msg.id, { content: "" });
            emit({ type: "message", message: { ...getMessage(msg.id)!, content: "", status: "streaming", error: null } });
            await sleep(wait, ac.signal);
          }
        } finally {
          if (!ended) {
            const status = ac.signal.aborted ? "stopped" : "error";
            const error = ac.signal.aborted ? null : "Stream ended unexpectedly";
            updateMessage(msg.id, { content: text, status, error });
            emit({ type: "status", id: msg.id, status, error });
          }
          running.delete(msg.id);
        }
      }));

      emit({ type: "end" });
      if (!closed) { try { controller.close(); } catch {} }
    },
    cancel() { closed = true; },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
