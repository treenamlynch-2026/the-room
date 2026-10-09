import type Anthropic from "@anthropic-ai/sdk";
import { anthropicClient, keyInfo, openaiClient, type KeyName } from "../keys";
import type { AgentAdapter, AgentEvent, AgentId, AgentRequest, Part } from "../types";

type NTurn = { role: "user" | "assistant"; parts: Part[] };

/** Merge consecutive same-role turns and guarantee the list starts and ends with a user turn. */
function normalizeTurns(turns: AgentRequest["turns"]): NTurn[] {
  const out: NTurn[] = [];
  for (const t of turns) {
    const parts: Part[] = typeof t.content === "string" ? [{ type: "text", text: t.content }] : t.content;
    const kept = parts.filter((p) => p.type !== "text" || p.text.trim());
    if (!kept.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.parts.push(...kept);
    else out.push({ role: t.role, parts: [...kept] });
  }
  if (!out.length || out[0].role !== "user") out.unshift({ role: "user", parts: [{ type: "text", text: "(conversation start)" }] });
  if (out[out.length - 1].role !== "user") out.push({ role: "user", parts: [{ type: "text", text: "(continue)" }] });
  return out;
}

const textOf = (parts: Part[]) => parts.map((p) => (p.type === "text" ? p.text : "")).filter(Boolean).join("\n\n");

/** OpenAI Responses API input items. */
function toOpenAI(turns: NTurn[]) {
  return turns.map((t) => {
    if (t.role === "assistant") return { role: "assistant" as const, content: textOf(t.parts) };
    return {
      role: "user" as const,
      content: t.parts.map((p) =>
        p.type === "text" ? { type: "input_text" as const, text: p.text }
        : p.type === "image" ? { type: "input_image" as const, image_url: `data:${p.mime};base64,${p.data}`, detail: "auto" as const }
        : { type: "input_file" as const, filename: p.name, file_data: `data:application/pdf;base64,${p.data}` }),
    };
  });
}

/** Anthropic Messages API messages, with prompt-cache breakpoints where the context marks them. */
function toAnthropic(turns: NTurn[]): Anthropic.MessageParam[] {
  return turns.map((t) => {
    if (t.role === "assistant") return { role: "assistant", content: textOf(t.parts) };
    return {
      role: "user",
      content: t.parts.map((p): Anthropic.ContentBlockParam => {
        const cache = p.cache ? { cache_control: { type: "ephemeral" as const } } : {};
        if (p.type === "text") return { type: "text", text: p.text, ...cache };
        if (p.type === "image") return { type: "image", source: { type: "base64", media_type: p.mime as "image/webp", data: p.data }, ...cache };
        return { type: "document", source: { type: "base64", media_type: "application/pdf", data: p.data }, title: p.name, ...cache };
      }),
    };
  });
}

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const statusOf = (e: unknown) => (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number" ? (e as { status: number }).status : undefined);

/** Connection drops, timeouts, rate limits, overloads and 5xx are worth retrying; auth and bad requests are not. */
export function isRetryable(e: unknown): boolean {
  const s = statusOf(e);
  if (s === undefined) return !/abort/i.test(errMsg(e)); // network-level: ECONNRESET, fetch failed, socket hang up, timeouts
  return s === 408 || s === 409 || s === 429 || s >= 500;
}

function describe(provider: "OpenAI" | "Anthropic", key: KeyName, e: unknown): string {
  const s = statusOf(e), msg = errMsg(e);
  if (s === 401 || s === 403) {
    const k = keyInfo(key);
    return `${provider} rejected the API key (${k.tail ?? "none"}, from ${k.source}). Fix ${key} in .env.local, then Retry — the Room re-reads it, no restart needed. [${msg}]`;
  }
  return msg;
}

export const openaiAdapter: AgentAdapter = {
  id: "chatgpt",
  async *send(req): AsyncIterable<AgentEvent> {
    const client = openaiClient();
    if (!client) { yield { type: "error", message: "OPENAI_API_KEY is not set in .env.local" }; return; }
    try {
      const stream = await client.responses.create(
        { model: req.model, instructions: req.system, input: toOpenAI(normalizeTurns(req.turns)), stream: true },
        { signal: req.signal }
      );
      let got = false;
      for await (const ev of stream) {
        if (ev.type === "response.output_text.delta") { got = true; yield { type: "delta", text: ev.delta }; }
        else if (ev.type === "response.completed") {
          const u = ev.response.usage;
          yield { type: "done", model: ev.response.model, usage: u ? { inputTokens: u.input_tokens, outputTokens: u.output_tokens } : undefined };
          return;
        } else if (ev.type === "response.failed") {
          const code = ev.response.error?.code || "";
          yield { type: "error", message: ev.response.error?.message || "OpenAI response failed", retryable: /server_error|rate_limit/.test(code) }; return;
        } else if (ev.type === "error") {
          yield { type: "error", message: ev.message, retryable: true }; return;
        }
      }
      // Ended without response.completed (e.g. response.incomplete at the token limit): keep partial text as before;
      // an empty, unterminated stream is a dropped connection, so let the runner retry it.
      if (got) yield { type: "done" };
      else yield { type: "error", message: "OpenAI stream closed before any output", retryable: true };
    } catch (e) {
      if (req.signal.aborted) return;
      yield { type: "error", message: describe("OpenAI", "OPENAI_API_KEY", e), retryable: isRetryable(e) };
    }
  },
};

export const anthropicAdapter: AgentAdapter = {
  id: "claude",
  async *send(req): AsyncIterable<AgentEvent> {
    const client = anthropicClient();
    if (!client) { yield { type: "error", message: "ANTHROPIC_API_KEY is not set in .env.local" }; return; }
    try {
      const stream = client.messages.stream(
        {
          model: req.model,
          max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS) || 8000,
          system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
          messages: toAnthropic(normalizeTurns(req.turns)),
        },
        { signal: req.signal }
      );
      for await (const ev of stream) {
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield { type: "delta", text: ev.delta.text };
      }
      const final = await stream.finalMessage();
      yield { type: "done", model: final.model, usage: { inputTokens: final.usage.input_tokens + (final.usage.cache_read_input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0), outputTokens: final.usage.output_tokens } }; // include cached input
    } catch (e) {
      if (req.signal.aborted) return;
      yield { type: "error", message: describe("Anthropic", "ANTHROPIC_API_KEY", e), retryable: isRetryable(e) };
    }
  },
};

/** Mock fault injection: a last turn containing "#mockfail<N>" fails the first N attempts per agent with a retryable error. */
const mockFails = new Map<string, number>();

/** MOCK_AGENTS=1: fake streaming replies, no API calls, no cost. For testing the room itself. */
function mockAdapter(id: AgentId): AgentAdapter {
  return {
    id,
    async *send(req) {
      const turns = normalizeTurns(req.turns);
      const all = turns.flatMap((t) => t.parts);
      const last = textOf(turns[turns.length - 1].parts);
      const fail = last.match(/#mockfail(\d)/);
      if (fail) {
        const key = id + "|" + last, n = mockFails.get(key) ?? 0;
        if (n < Number(fail[1])) { mockFails.set(key, n + 1); yield { type: "error", message: `mock connection reset (attempt ${n + 1})`, retryable: true }; return; }
      }
      const canon = (req.system.match(/^## \[P\d\]/gm) || []).length;
      const imgs = all.filter((p) => p.type === "image").length, pdfs = all.filter((p) => p.type === "pdf").length;
      const reply = `**Mock ${id === "claude" ? "Claude" : "Iris"} reply** (no API call).\n\n- Context: ${canon} canon entries, ${turns.length} turns, ${imgs} images, ${pdfs} PDFs, model \`${req.model}\`\n- Last turn: “${last.slice(0, 120).replace(/\n/g, " ")}”`;
      for (const word of reply.split(/(?<= )/)) {
        if (req.signal.aborted) return;
        await new Promise((r) => setTimeout(r, Number(process.env.MOCK_DELAY_MS) || 25));
        yield { type: "delta", text: word };
      }
      yield { type: "done", model: req.model + " (mock)", usage: { inputTokens: req.system.length >> 2, outputTokens: reply.length >> 2 } };
    },
  };
}

export const adapters: Record<AgentId, AgentAdapter> = process.env.MOCK_AGENTS === "1"
  ? { chatgpt: mockAdapter("chatgpt"), claude: mockAdapter("claude") }
  : { chatgpt: openaiAdapter, claude: anthropicAdapter };

/** Collect a full (non-streamed-to-client) response, e.g. for summaries. */
export async function complete(agent: AgentId, req: AgentRequest): Promise<string> {
  let text = "";
  for await (const ev of adapters[agent].send(req)) {
    if (ev.type === "delta") text += ev.text;
    if (ev.type === "error") throw new Error(ev.message);
  }
  return text;
}

export async function listModels(): Promise<Record<AgentId, string[]>> {
  const out: Record<AgentId, string[]> = { chatgpt: [], claude: [] };
  await Promise.all([
    (async () => {
      const c = openaiClient();
      if (!c) return;
      try {
        for await (const m of c.models.list()) if (/^(gpt|o\d)/.test(m.id)) out.chatgpt.push(m.id);
        out.chatgpt.sort();
      } catch {}
    })(),
    (async () => {
      const c = anthropicClient();
      if (!c) return;
      try {
        for await (const m of c.models.list()) out.claude.push(m.id);
      } catch {}
    })(),
  ]);
  return out;
}
