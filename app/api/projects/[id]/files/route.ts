import fs from "node:fs";
import path from "node:path";
import { createFile, deleteFile, newId, setFileNote, UPLOAD_DIR } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";
import { kindOf, prepareFile } from "@/lib/media";

const MAX = 500 * 1024 * 1024;

/**
 * Upload files. Images are downscaled, videos get frames + transcript, PDFs are checked.
 * ?forMessage=1 → the files will be attached to the next message (not pinned project-wide).
 */
export async function POST(req: Request, { params }: Ctx) {
  const projectId = (await params).id;
  const forMessage = new URL(req.url).searchParams.get("forMessage") === "1";
  const form = await req.formData();
  const files = form.getAll("file").filter((f): f is File => f instanceof File);
  if (!files.length) return bad("no file");
  const out: { id: string; name: string; kind: string; note: string | null; error?: string }[] = [];
  for (const f of files) {
    if (f.size > MAX) return bad(`${f.name} exceeds 500 MB`);
    const dir = path.join(UPLOAD_DIR, projectId);
    fs.mkdirSync(dir, { recursive: true });
    const stored = path.join(dir, newId() + path.extname(f.name).replace(/[^.\w]/g, ""));
    fs.writeFileSync(stored, Buffer.from(await f.arrayBuffer()));
    const mime = f.type || "application/octet-stream";
    const kind = kindOf(f.name, mime);
    // Pinned by default: text, images, PDFs uploaded to the Files tab. Never videos (many frames, every call).
    const inContext = !forMessage && kind !== "video" && kind !== "other";
    const id = createFile(projectId, { name: f.name, mime, size: f.size, storedPath: stored, kind, inContext });
    try {
      const note = await prepareFile(stored, kind, f.size);
      setFileNote(id, note);
      out.push({ id, name: f.name, kind, note });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (kind === "image" || kind === "video") {
        deleteFile(id);
        return bad(`${f.name}: could not process ${kind} (${msg})`, 422);
      }
      setFileNote(id, `processing failed: ${msg}`);
      out.push({ id, name: f.name, kind, note: null, error: msg });
    }
  }
  return json({ files: out });
}
