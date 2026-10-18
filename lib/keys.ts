import fs from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

/**
 * API keys and provider clients.
 *
 * Root cause of the "both drop, Retry fails, must reset the key" bug:
 * - Keys were read once from process.env at server start. Next.js never lets .env.local override a variable that
 *   already exists in the OS environment, and both keys are ALSO set as Windows user environment variables. So an
 *   edited/rotated key in .env.local was silently ignored (a 401 with an old OpenAI key is in the message history),
 *   and nothing short of a full restart picked up a change.
 * - Fix: .env.local is re-read on every call (cached by mtime) and wins over the OS environment; clients are rebuilt
 *   whenever the key changes, and resetClients() forces a rebuild (used by Retry and the header Reset button).
 */
const ENV_FILE = path.join(process.cwd(), ".env.local");
let fileCache: { mtime: number; vals: Record<string, string> } | null = null;

function fileVals(): Record<string, string> {
  try {
    const st = fs.statSync(ENV_FILE);
    if (!fileCache || fileCache.mtime !== st.mtimeMs) {
      const vals: Record<string, string> = {};
      for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
        const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
        if (!m) continue;
        let v = m[2];
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        else v = v.replace(/\s+#.*$/, "");
        vals[m[1]] = v;
      }
      fileCache = { mtime: st.mtimeMs, vals };
    }
    return fileCache.vals;
  } catch {
    return {};
  }
}

export type KeyName = "OPENAI_API_KEY" | "ANTHROPIC_API_KEY";
export function apiKey(name: KeyName): string | undefined {
  return fileVals()[name] || process.env[name] || undefined;
}
/** Safe description of a key for logs and the health endpoint: never the key itself. */
export function keyInfo(name: KeyName) {
  const f = fileVals()[name], e = process.env[name];
  const k = f || e;
  return {
    set: !!k,
    source: f ? ".env.local" : e ? "OS environment" : "missing",
    tail: null, // No credential characters in diagnostics.
    shadowed: !!(f && e && f !== e), // OS env var differs from .env.local (the .env.local value is used)
  };
}

const MAX_RETRIES = 3; // SDK-level retries for connection errors, 408/409/429/5xx
const TIMEOUT_MS = 10 * 60_000;
const g = globalThis as unknown as { __roomClients?: { openai?: [string, OpenAI]; anthropic?: [string, Anthropic]; gen: number } };
const clients = (g.__roomClients ??= { gen: 0 });

export function openaiClient(): OpenAI | null {
  const k = apiKey("OPENAI_API_KEY");
  if (!k) return null;
  if (!clients.openai || clients.openai[0] !== k) clients.openai = [k, new OpenAI({ apiKey: k, maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS })];
  return clients.openai[1];
}
export function anthropicClient(): Anthropic | null {
  const k = apiKey("ANTHROPIC_API_KEY");
  if (!k) return null;
  if (!clients.anthropic || clients.anthropic[0] !== k) clients.anthropic = [k, new Anthropic({ apiKey: k, maxRetries: MAX_RETRIES, timeout: TIMEOUT_MS })];
  return clients.anthropic[1];
}
/** Drop cached clients and the .env.local cache so the next call re-reads keys and opens fresh connections. */
export function resetClients() {
  clients.openai = undefined;
  clients.anthropic = undefined;
  clients.gen++;
  fileCache = null;
}

/** Cheap, free connectivity + auth check (lists models). */
export async function probe(): Promise<Record<"chatgpt" | "claude", { ok: boolean; error?: string; ms: number }>> {
  const run = async (fn: () => Promise<unknown>) => {
    const t = Date.now();
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after 10s")), 10_000))]);
      return { ok: true, ms: Date.now() - t };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), ms: Date.now() - t };
    }
  };
  const [chatgpt, claude] = await Promise.all([
    run(async () => { const c = openaiClient(); if (!c) throw new Error("OPENAI_API_KEY is not set in .env.local"); await c.models.list(); }),
    run(async () => { const c = anthropicClient(); if (!c) throw new Error("ANTHROPIC_API_KEY is not set in .env.local"); await c.models.list({ limit: 1 }); }),
  ]);
  return { chatgpt, claude };
}

let warned = false;
/** One-time startup warning when OS env vars disagree with .env.local. */
export function warnShadowedKeys() {
  if (warned) return;
  warned = true;
  for (const n of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as KeyName[]) {
    const i = keyInfo(n);
    if (i.shadowed) console.warn(`[room] ${new Date().toISOString()} ${n}: Windows environment variable differs from .env.local — using .env.local (${i.tail}).`);
    if (!i.set) console.warn(`[room] ${new Date().toISOString()} ${n} is not set.`);
  }
}
