import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import Busboy from "busboy";

export const MAX_UPLOAD_FILE = 32 * 1024 * 1024;
export const MAX_UPLOAD_REQUEST = 64 * 1024 * 1024;
export class UploadError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const validProjectId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

let uploadBusy = false;
export function acquireUpload(): (() => void) | null {
  if (uploadBusy) return null;
  uploadBusy = true;
  return () => { uploadBusy = false; };
}
export type ReceivedFile = { name: string; mime: string; size: number; stored: string };

/** Parse directly to exclusive-created files; cap the entire stream, not just Content-Length. */
export async function receiveUploads(req: Request, root: string, projectId: string): Promise<ReceivedFile[]> {
  if (!validProjectId(projectId)) throw new UploadError("Invalid project ID");
  if (!req.body) throw new UploadError("Missing upload body");
  const declared = Number(req.headers.get("content-length"));
  if (declared > MAX_UPLOAD_REQUEST) throw new UploadError("Upload exceeds 64 MB", 413);
  const realRoot = await fsp.realpath(root);
  const dir = path.resolve(realRoot, projectId);
  if (!dir.startsWith(realRoot + path.sep)) throw new UploadError("Invalid upload path");
  await fsp.mkdir(dir, { recursive: true });
  if (await fsp.realpath(dir) !== dir) throw new UploadError("Invalid upload directory");
  let parser;
  try {
    parser = Busboy({ headers: { "content-type": req.headers.get("content-type") || "" },
      limits: { files: 4, fileSize: MAX_UPLOAD_FILE, fields: 0, parts: 4, headerPairs: 50 } });
  } catch { throw new UploadError("Invalid multipart upload"); }
  const result: ReceivedFile[] = [], tasks: Promise<void>[] = [];
  const cancel = new AbortController();
  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(60_000), cancel.signal]);
  let failure: Error | null = null, bytes = 0;
  parser.on("filesLimit", () => { failure = new UploadError("At most 4 files per upload", 413); });
  parser.on("fieldsLimit", () => { failure = new UploadError("Unexpected form field"); });
  parser.on("partsLimit", () => { failure = new UploadError("Too many upload parts", 413); });
  parser.on("file", (field, file, info) => {
    if (field !== "file" || !info.filename) { failure = new UploadError("Invalid file field"); file.resume(); return; }
    const name = path.basename(info.filename).slice(0, 200);
    const stored = path.join(dir, randomUUID() + path.extname(name).replace(/[^.\w]/g, "").slice(0, 16));
    const entry = { name, mime: info.mimeType || "application/octet-stream", size: 0, stored };
    result.push(entry);
    file.on("limit", () => { failure = new UploadError("File exceeds 32 MB", 413); });
    file.on("data", (chunk: Buffer) => { entry.size += chunk.length; });
    tasks.push(pipeline(file, fs.createWriteStream(stored, { flags: "wx", mode: 0o600 }), { signal })
      .catch((e: Error) => { failure = e; }));
  });
  const count = new Transform({ transform(chunk: Buffer, _encoding, cb) {
    bytes += chunk.length;
    cb(bytes > MAX_UPLOAD_REQUEST ? new UploadError("Upload exceeds 64 MB", 413) : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(req.body as import("node:stream/web").ReadableStream), count, parser, { signal });
    await Promise.all(tasks);
    if (failure) throw failure;
    if (!result.length) throw new UploadError("No files supplied");
    return result;
  } catch (e) {
    cancel.abort();
    parser.destroy();
    await Promise.all(tasks);
    await Promise.all(result.map(f => fsp.unlink(f.stored).catch(() => {})));
    throw e instanceof UploadError ? e : new UploadError("Upload interrupted or malformed");
  }
}
