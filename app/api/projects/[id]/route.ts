import { deleteProject, getState, updateProject } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";

export async function GET(_: Request, { params }: Ctx) {
  const s = getState((await params).id);
  return s ? json(s) : bad("not found", 404);
}
export async function PATCH(req: Request, { params }: Ctx) {
  const id = (await params).id;
  updateProject(id, await req.json());
  return json(getState(id));
}
export async function DELETE(_: Request, { params }: Ctx) {
  deleteProject((await params).id);
  return json({ ok: true });
}
