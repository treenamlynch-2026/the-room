import { createDecision } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";

export async function POST(req: Request, { params }: Ctx) {
  const { text, sourceMessageId } = await req.json();
  if (!text?.trim()) return bad("text required");
  createDecision((await params).id, text.trim(), sourceMessageId);
  return json({ ok: true });
}
