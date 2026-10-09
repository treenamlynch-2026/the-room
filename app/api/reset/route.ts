import { json } from "@/lib/http";
import { keyInfo, probe, resetClients } from "@/lib/keys";
import { running } from "@/lib/run";

export const dynamic = "force-dynamic";

/**
 * Re-initialize both provider connections: drop cached clients, re-read .env.local, then probe both providers.
 * body.abort = true also stops every in-flight reply (header Reset button); Retry calls it without abort.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  let aborted = 0;
  if (body.abort) for (const [, ac] of running) { ac.abort(); aborted++; }
  resetClients();
  console.log(`[room] ${new Date().toISOString()} provider clients reset${aborted ? `, ${aborted} reply(s) stopped` : ""}`);
  const skip = { chatgpt: { ok: true, ms: 0 }, claude: { ok: true, ms: 0 } };
  const providers = process.env.MOCK_AGENTS === "1" || body.probe === false ? skip : await probe();
  return json({ ok: providers.chatgpt.ok && providers.claude.ok, aborted, providers,
    keys: { chatgpt: keyInfo("OPENAI_API_KEY"), claude: keyInfo("ANTHROPIC_API_KEY") } });
}
