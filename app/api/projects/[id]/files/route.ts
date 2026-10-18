import fs from "node:fs/promises";
import { createFile, deleteFile, getProject, setFileNote, UPLOAD_DIR } from "@/lib/db";
import { bad, json, type Ctx } from "@/lib/http";
import { kindOf, prepareFile } from "@/lib/media";
import { acquireUpload, receiveUploads, UploadError, validProjectId, type ReceivedFile } from "@/lib/uploads";

export async function POST(req: Request, { params }: Ctx) {
  const projectId = (await params).id;
  if (!validProjectId(projectId)) return bad("Invalid project ID");
  if (!getProject(projectId)) return bad("not found", 404);
  const release = acquireUpload();
  if (!release) return bad("Another upload is being processed. Try again shortly.", 429);
  const forMessage = new URL(req.url).searchParams.get("forMessage") === "1";
  let files: ReceivedFile[] = [];
  const created: string[] = [];
  try {
    files = await receiveUploads(req, UPLOAD_DIR, projectId);
    const out = [];
    for (const f of files) {
      const kind = kindOf(f.name, f.mime);
      const id = createFile(projectId, { name: f.name, mime: f.mime, size: f.size, storedPath: f.stored,
        kind, inContext: !forMessage && kind !== "video" && kind !== "other" });
      created.push(id);
      const note = await prepareFile(f.stored, kind, f.size);
      setFileNote(id, note);
      out.push({ id, name: f.name, kind, note });
    }
    return json({ files: out });
  } catch (e) {
    for (const id of created) deleteFile(id);
    await Promise.all(files.map(f => fs.unlink(f.stored).catch(() => {})));
    return bad(e instanceof UploadError ? e.message : "Could not process upload", e instanceof UploadError ? e.status : 422);
  } finally { release(); }
}
