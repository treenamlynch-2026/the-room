import { deleteCanon, updateCanon } from "@/lib/db";
import { json, type Ctx } from "@/lib/http";

export async function PATCH(req: Request, { params }: Ctx) {
  updateCanon((await params).id, await req.json());
  return json({ ok: true });
}
export async function DELETE(_: Request, { params }: Ctx) {
  deleteCanon((await params).id);
  return json({ ok: true });
}
