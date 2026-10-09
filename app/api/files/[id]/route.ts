import fs from "node:fs";
import { deleteFile, getFileRow, setFileInContext } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";

export async function GET(_: Request, { params }: Ctx) {
  const f = getFileRow((await params).id);
  if (!f) return bad("not found", 404);
  return new Response(fs.readFileSync(f.stored_path), {
    headers: { "Content-Type": f.mime, "Content-Disposition": `inline; filename="${encodeURIComponent(f.name)}"` },
  });
}
export async function PATCH(req: Request, { params }: Ctx) {
  setFileInContext((await params).id, !!(await req.json()).inContext);
  return json({ ok: true });
}
export async function DELETE(_: Request, { params }: Ctx) {
  deleteFile((await params).id);
  return json({ ok: true });
}
