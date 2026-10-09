import { deleteDecision, updateDecision } from "@/lib/db";
import { json, type Ctx } from "@/lib/http";

export async function PATCH(req: Request, { params }: Ctx) {
  updateDecision((await params).id, (await req.json()).text);
  return json({ ok: true });
}
export async function DELETE(_: Request, { params }: Ctx) {
  deleteDecision((await params).id);
  return json({ ok: true });
}
