import { json } from "@/lib/http";
import { keyInfo, probe } from "@/lib/keys";
import { running } from "@/lib/run";
import { diskBuildId, server } from "@/lib/server-info";

export const dynamic = "force-dynamic";

/** Liveness + build identity for the client's reconnect loop and new-build check. ?probe=1 also checks both providers (free: lists models). */
export async function GET(req: Request) {
  const disk = diskBuildId();
  const body: Record<string, unknown> = {
    ok: true,
    buildId: server.buildId,
    stale: disk !== server.buildId, // .next was rebuilt under this process: it must be restarted
    diskBuildId: disk,
    pid: process.pid,
    startedAt: server.startedAt,
    running: running.size,
    mock: process.env.MOCK_AGENTS === "1",
    keys: { chatgpt: keyInfo("OPENAI_API_KEY"), claude: keyInfo("ANTHROPIC_API_KEY") },
  };
  if (new URL(req.url).searchParams.get("probe") === "1" && process.env.MOCK_AGENTS !== "1") body.providers = await probe();
  return json(body);
}
