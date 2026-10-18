import fs from "node:fs";
import { Readable } from "node:stream";
import { deleteFile, getFileRow, setFileInContext } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";

export async function GET(_: Request, { params }: Ctx) {
  const f = getFileRow((await params).id);
  if (!f) return bad("not found", 404);
  // Only server-decoded WebP previews may render inline. Upload MIME is untrusted.
  const preview = f.kind === "image" && fs.existsSync(f.stored_path + ".ctx.webp");
  const stored = preview ? f.stored_path + ".ctx.webp" : f.stored_path;
  if (!fs.existsSync(stored)) return bad("not found", 404);
  return new Response(Readable.toWeb(fs.createReadStream(stored)) as ReadableStream, {
    headers: {
      "Content-Type": preview ? "image/webp" : "application/octet-stream",
      "Content-Disposition": `${preview ? "inline" : "attachment"}; filename="${encodeURIComponent(f.name)}${preview ? ".webp" : ""}"`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'none'",
      "Cache-Control": "no-store",
    },
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
