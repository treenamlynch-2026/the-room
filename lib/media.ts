import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import ffmpegPath from "ffmpeg-static";
import { openaiClient } from "./keys";
import type { FileRow } from "./db";
import type { FileKind, Part } from "./types";

const run = promisify(execFile);

const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|ya?ml|xml|html?|css|js|jsx|ts|tsx|py|cs|sql|sh|srt|vtt|ini|toml|log)$/i;
const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp|bmp|tiff|avif|heic|heif)$/i;
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|avif|heic|heif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|mkv|avi)$/i;

export function kindOf(name: string, mime: string): FileKind {
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (IMAGE_MIME.test(mime) || IMAGE_EXT.test(name)) return "image";
  if (mime.startsWith("video/") || VIDEO_EXT.test(name)) return "video";
  if (mime.startsWith("text/") || mime === "application/json" || TEXT_EXT.test(name)) return "text";
  return "other";
}

const MAX_EDGE = () => Number(process.env.IMAGE_MAX_EDGE) || 1568;
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const VIDEO_FRAMES = () => Number(process.env.VIDEO_MAX_FRAMES) || 12;
const FRAME_WIDTH = () => Number(process.env.VIDEO_FRAME_WIDTH) || 768;

/** Downscale once at upload, cached next to the original, so every later call sends a small WebP. */
export async function prepareImage(stored: string): Promise<string> {
  const out = stored + ".ctx.webp";
  const meta = await sharp(stored, { animated: false }).metadata();
  await sharp(stored, { animated: false }).rotate()
    .resize({ width: MAX_EDGE(), height: MAX_EDGE(), fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 }).toFile(out);
  return `${meta.width}×${meta.height}`;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

async function probeDuration(file: string): Promise<number> {
  // ffmpeg prints "Duration: 00:01:23.45" to stderr and exits non-zero without an output file.
  const r = await run(ffmpegPath!, ["-hide_banner", "-i", file]).catch((e) => e as { stderr: string });
  const m = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(r.stderr || "");
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/**
 * Same approach as the Watch skill's local engine: sample frames evenly with FFmpeg and
 * transcribe the audio, so a model that can't take video can still "watch" it.
 * Output: <stored>.video/frames.json, frame_###.jpg, transcript.txt
 */
export async function prepareVideo(stored: string): Promise<string> {
  if (!ffmpegPath) throw new Error("FFmpeg binary not available (ffmpeg-static failed to install)");
  const dir = stored + ".video";
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const dur = await probeDuration(stored);
  if (!dur) throw new Error("Could not read video duration");

  const n = Math.max(1, Math.min(VIDEO_FRAMES(), Math.ceil(dur)));
  const frames: { t: number; file: string }[] = [];
  for (let i = 0; i < n; i++) {
    const t = ((i + 0.5) * dur) / n;
    const file = `frame_${String(i + 1).padStart(3, "0")}.jpg`;
    await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", t.toFixed(2), "-i", stored, "-frames:v", "1",
      "-vf", `scale=${FRAME_WIDTH()}:-2`, "-q:v", "4", "-y", path.join(dir, file)]);
    if (fs.existsSync(path.join(dir, file))) frames.push({ t, file });
  }
  fs.writeFileSync(path.join(dir, "frames.json"), JSON.stringify({ duration: dur, frames }));

  let transcriptNote = "no transcript";
  const audio = path.join(dir, "audio.mp3");
  const hasAudio = await run(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-i", stored, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", audio])
    .then(() => fs.existsSync(audio) && fs.statSync(audio).size > 1000).catch(() => false);
  if (!hasAudio) transcriptNote = "no audio track";
  else if (process.env.MOCK_AGENTS === "1") transcriptNote = "transcript skipped (mock mode)";
  else if (!openaiClient()) transcriptNote = "no transcript (OPENAI_API_KEY not set)";
  else if (fs.statSync(audio).size > 24_000_000) transcriptNote = "no transcript (audio over 24 MB)";
  else {
    try {
      const tr = await openaiClient()!.audio.transcriptions.create({
        file: fs.createReadStream(audio), model: process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe",
      });
      fs.writeFileSync(path.join(dir, "transcript.txt"), tr.text);
      transcriptNote = "transcript";
    } catch (e) {
      transcriptNote = `transcription failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  try { fs.unlinkSync(audio); } catch {}
  return `${fmt(dur)} · ${frames.length} frames · ${transcriptNote}`;
}

/** Run the right preparation step for a newly uploaded file. Returns a short note for the Files tab. */
export async function prepareFile(stored: string, kind: FileKind, size: number): Promise<string | null> {
  if (kind === "image") return `image ${await prepareImage(stored)}`;
  if (kind === "video") return await prepareVideo(stored);
  if (kind === "pdf") return size > MAX_PDF_BYTES ? "PDF over 30 MB — listed by name only" : null;
  return null;
}

const b64 = (p: string) => fs.readFileSync(p).toString("base64");

/** Turn one stored file into model-ready parts. Text files are handled in the system prompt instead. */
export function fileParts(f: FileRow): Part[] {
  const label = (extra = ""): Part => ({ type: "text", text: `[File: ${f.name}${extra}]` });
  try {
    if (f.kind === "image") {
      const p = f.stored_path + ".ctx.webp";
      if (!fs.existsSync(p)) return [label(" — image could not be processed")];
      return [label(), { type: "image", mime: "image/webp", data: b64(p) }];
    }
    if (f.kind === "pdf") {
      if (f.size > MAX_PDF_BYTES) return [label(" — PDF too large to send")];
      return [label(), { type: "pdf", name: f.name, data: b64(f.stored_path) }];
    }
    if (f.kind === "video") {
      const dir = f.stored_path + ".video";
      const meta = JSON.parse(fs.readFileSync(path.join(dir, "frames.json"), "utf8")) as { duration: number; frames: { t: number; file: string }[] };
      const parts: Part[] = [label(` — video, ${fmt(meta.duration)}, ${meta.frames.length} evenly spaced frames`)];
      for (const fr of meta.frames) {
        parts.push({ type: "text", text: `[${f.name} @ ${fmt(fr.t)}]` });
        parts.push({ type: "image", mime: "image/jpeg", data: b64(path.join(dir, fr.file)) });
      }
      const tp = path.join(dir, "transcript.txt");
      parts.push({ type: "text", text: fs.existsSync(tp) ? `[${f.name} — audio transcript]\n${fs.readFileSync(tp, "utf8")}` : `[${f.name} — no transcript available]` });
      return parts;
    }
  } catch {
    return [label(" — could not be read")];
  }
  return [label(` — ${f.mime}, not viewable by the models`)];
}
