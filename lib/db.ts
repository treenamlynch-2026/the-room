import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AgentId, CanonEntry, Decision, Message, Project, ProjectFile, ProjectState } from "./types";

/** ROOM_DATA_DIR lets a second instance (tests, MOCK_AGENTS) run against a scratch database instead of ./data. */
export const DATA_DIR = process.env.ROOM_DATA_DIR ? path.resolve(process.env.ROOM_DATA_DIR) : path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const g = globalThis as unknown as { __roomDb?: DatabaseSync };
const freshProcess = !g.__roomDb;
// Built-in SQLite (Node 22.13+): no native build step on any OS.
export const db = g.__roomDb ?? new DatabaseSync(path.join(DATA_DIR, "room.db"), { timeout: 15000 });
g.__roomDb = db;
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT,
  status TEXT NOT NULL DEFAULT 'active', default_routing TEXT NOT NULL DEFAULT 'both',
  conversation_summary TEXT, summary_through_id TEXT,
  model_chatgpt TEXT, model_claude TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL, author TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL, reply_to_id TEXT, routing TEXT, status TEXT, model TEXT,
  usage TEXT, error TEXT, approved INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, seq);
CREATE TABLE IF NOT EXISTS canon (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', priority INTEGER NOT NULL DEFAULT 2,
  source TEXT NOT NULL DEFAULT '', pinned INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  text TEXT NOT NULL, source_message_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, stored_path TEXT NOT NULL,
  in_context INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
`);

// Migrations for databases created by the first build.
const addCol = (table: string, col: string, def: string) => {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (!cols.some((c) => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
};
addCol("projects", "model_chatgpt_deep", "TEXT");
addCol("projects", "model_claude_deep", "TEXT");
addCol("files", "kind", "TEXT NOT NULL DEFAULT 'other'");
addCol("files", "message_id", "TEXT");
addCol("files", "note", "TEXT");
addCol("messages", "approved_by", "TEXT");

// A server stop/crash mid-reply used to leave messages stuck in "streaming" forever: the UI showed "working",
// polled endlessly and offered no Retry. On process start nothing can be running yet, so mark them retryable.
if (freshProcess) {
  const r = db.prepare("UPDATE messages SET status = 'error', error = ? WHERE status IN ('streaming', 'queued')")
    .run("Interrupted: the Room server stopped mid-reply. Retry to regenerate.");
  if (Number(r.changes)) console.log(`[room] ${new Date().toISOString()} marked ${r.changes} interrupted message(s) as retryable`);
}

export const now = () => new Date().toISOString();
export const newId = () => randomUUID();

const defaultModel = (a: AgentId) =>
  a === "chatgpt" ? process.env.OPENAI_MODEL || "gpt-6.1-sol" : process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
const defaultDeepModel = (a: AgentId) =>
  a === "chatgpt" ? process.env.OPENAI_DEEP_MODEL || "gpt-6-astra" : process.env.ANTHROPIC_DEEP_MODEL || "claude-opus-5-5";

/* eslint-disable @typescript-eslint/no-explicit-any */
const toProject = (r: any): Project => ({
  id: r.id, name: r.name, description: r.description, status: r.status, defaultRouting: r.default_routing,
  conversationSummary: r.conversation_summary, summaryThroughId: r.summary_through_id,
  models: { chatgpt: r.model_chatgpt || defaultModel("chatgpt"), claude: r.model_claude || defaultModel("claude") },
  deepModels: { chatgpt: r.model_chatgpt_deep || defaultDeepModel("chatgpt"), claude: r.model_claude_deep || defaultDeepModel("claude") },
  createdAt: r.created_at, updatedAt: r.updated_at,
});
export const toMessage = (r: any): Message => ({
  id: r.id, projectId: r.project_id, author: r.author, content: r.content, createdAt: r.created_at,
  replyToId: r.reply_to_id, routing: r.routing ? JSON.parse(r.routing) : null, status: r.status, model: r.model,
  usage: r.usage ? JSON.parse(r.usage) : null, error: r.error, approved: !!r.approved,
  approvedBy: r.approved_by ?? null,
});
const toCanon = (r: any): CanonEntry => ({
  id: r.id, projectId: r.project_id, title: r.title, body: r.body, priority: r.priority, source: r.source,
  pinned: !!r.pinned, active: !!r.active, createdAt: r.created_at,
});
const toDecision = (r: any): Decision => ({
  id: r.id, projectId: r.project_id, text: r.text, sourceMessageId: r.source_message_id, createdAt: r.created_at,
});
const toFile = (r: any): ProjectFile => ({
  id: r.id, projectId: r.project_id, name: r.name, mime: r.mime, size: r.size, kind: r.kind, inContext: !!r.in_context,
  messageId: r.message_id, note: r.note, createdAt: r.created_at,
});

// ---------- projects ----------
export function listProjects(): Project[] {
  return db.prepare("SELECT * FROM projects ORDER BY status = 'archived', updated_at DESC").all().map(toProject);
}
export function getProject(id: string): Project | null {
  const r = db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return r ? toProject(r) : null;
}
export function createProject(name: string, description?: string): Project {
  const id = newId(), t = now();
  db.prepare("INSERT INTO projects (id, name, description, created_at, updated_at) VALUES (?,?,?,?,?)").run(id, name, description ?? null, t, t);
  return getProject(id)!;
}
const PROJECT_COLS: Record<string, string> = {
  name: "name", description: "description", status: "status", defaultRouting: "default_routing",
  conversationSummary: "conversation_summary", summaryThroughId: "summary_through_id",
  modelChatgpt: "model_chatgpt", modelClaude: "model_claude",
  modelChatgptDeep: "model_chatgpt_deep", modelClaudeDeep: "model_claude_deep",
};
export function updateProject(id: string, patch: Record<string, unknown>) {
  for (const [k, v] of Object.entries(patch)) {
    const col = PROJECT_COLS[k];
    if (col) db.prepare(`UPDATE projects SET ${col} = ? WHERE id = ?`).run(v as string | null, id);
  }
  touch(id);
}
export const touch = (id: string) => db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").run(now(), id);
export const deleteProject = (id: string) => db.prepare("DELETE FROM projects WHERE id = ?").run(id);

export function getState(id: string): ProjectState | null {
  const project = getProject(id);
  if (!project) return null;
  return {
    project,
    messages: listMessages(id),
    canon: db.prepare("SELECT * FROM canon WHERE project_id = ? ORDER BY pinned DESC, priority ASC, created_at").all(id).map(toCanon),
    decisions: db.prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY created_at").all(id).map(toDecision),
    files: db.prepare("SELECT * FROM files WHERE project_id = ? ORDER BY created_at").all(id).map(toFile),
  };
}

// ---------- messages ----------
export function listMessages(projectId: string): Message[] {
  return db.prepare("SELECT * FROM messages WHERE project_id = ? ORDER BY seq").all(projectId).map(toMessage);
}
export function getMessage(id: string): Message | null {
  const r = db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
  return r ? toMessage(r) : null;
}
export function messageSeq(id: string): number {
  return (db.prepare("SELECT seq FROM messages WHERE id = ?").get(id) as { seq: number } | undefined)?.seq ?? Infinity;
}
export function insertMessage(m: Omit<Message, "id" | "createdAt"> & { id?: string }): Message {
  const id = m.id ?? newId(), t = now();
  const seq = ((db.prepare("SELECT MAX(seq) AS s FROM messages WHERE project_id = ?").get(m.projectId) as { s: number | null }).s ?? 0) + 1;
  db.prepare(
    "INSERT INTO messages (id, project_id, seq, author, content, created_at, reply_to_id, routing, status, model, usage, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(id, m.projectId, seq, m.author, m.content, t, m.replyToId ?? null, m.routing ? JSON.stringify(m.routing) : null,
    m.status ?? null, m.model ?? null, m.usage ? JSON.stringify(m.usage) : null, m.error ?? null);
  touch(m.projectId);
  return getMessage(id)!;
}
export function updateMessage(id: string, patch: Partial<Pick<Message, "content" | "status" | "model" | "usage" | "error" | "approved" | "approvedBy">>) {
  const sets: string[] = [], vals: (string | number | null)[] = [];
  if (patch.content !== undefined) { sets.push("content = ?"); vals.push(patch.content); }
  if (patch.status !== undefined) { sets.push("status = ?"); vals.push(patch.status ?? null); }
  if (patch.model !== undefined) { sets.push("model = ?"); vals.push(patch.model ?? null); }
  if (patch.usage !== undefined) { sets.push("usage = ?"); vals.push(patch.usage ? JSON.stringify(patch.usage) : null); }
  if (patch.error !== undefined) { sets.push("error = ?"); vals.push(patch.error ?? null); }
  if (patch.approved !== undefined) { sets.push("approved = ?"); vals.push(patch.approved ? 1 : 0); }
  if (patch.approvedBy !== undefined) { sets.push("approved_by = ?"); vals.push(patch.approvedBy ?? null); }
  if (sets.length) db.prepare(`UPDATE messages SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
}
export function searchMessages(projectId: string, q: string): Message[] {
  return db.prepare("SELECT * FROM messages WHERE project_id = ? AND content LIKE ? ESCAPE '\\' ORDER BY seq")
    .all(projectId, `%${q.replace(/[%_]/g, (c) => "\\" + c)}%`).map(toMessage);
}
/** Any message left "streaming" by a crash or restart is marked as an error so it can be retried. */
db.prepare("UPDATE messages SET status = 'error', error = 'Interrupted (server restarted)' WHERE status IN ('streaming','queued')").run();

// ---------- canon ----------
export function createCanon(projectId: string, c: Partial<CanonEntry>): void {
  db.prepare("INSERT INTO canon (id, project_id, title, body, priority, source, pinned, active, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(newId(), projectId, c.title || "Untitled", c.body ?? "", c.priority ?? 2, c.source ?? "", c.pinned ? 1 : 0, c.active === false ? 0 : 1, now());
  touch(projectId);
}
export function updateCanon(id: string, c: Partial<CanonEntry>) {
  const cur = db.prepare("SELECT * FROM canon WHERE id = ?").get(id);
  if (!cur) return;
  const m = { ...toCanon(cur), ...c };
  db.prepare("UPDATE canon SET title=?, body=?, priority=?, source=?, pinned=?, active=? WHERE id=?")
    .run(m.title, m.body, m.priority, m.source, m.pinned ? 1 : 0, m.active ? 1 : 0, id);
}
export const deleteCanon = (id: string) => db.prepare("DELETE FROM canon WHERE id = ?").run(id);

// ---------- decisions ----------
export function createDecision(projectId: string, text: string, sourceMessageId?: string | null) {
  db.prepare("INSERT INTO decisions (id, project_id, text, source_message_id, created_at) VALUES (?,?,?,?,?)")
    .run(newId(), projectId, text, sourceMessageId ?? null, now());
  touch(projectId);
}
export const updateDecision = (id: string, text: string) => db.prepare("UPDATE decisions SET text = ? WHERE id = ?").run(text, id);
export const deleteDecision = (id: string) => db.prepare("DELETE FROM decisions WHERE id = ?").run(id);

// ---------- files ----------
export type FileRow = {
  id: string; project_id: string; name: string; mime: string; size: number; stored_path: string;
  in_context: number; kind: string; message_id: string | null; note: string | null;
};
export function createFile(projectId: string, f: { name: string; mime: string; size: number; storedPath: string; kind: string; inContext: boolean }): string {
  const id = newId();
  db.prepare("INSERT INTO files (id, project_id, name, mime, size, stored_path, kind, in_context, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, projectId, f.name, f.mime, f.size, f.storedPath, f.kind, f.inContext ? 1 : 0, now());
  touch(projectId);
  return id;
}
export const setFileNote = (id: string, note: string | null) => db.prepare("UPDATE files SET note = ? WHERE id = ?").run(note, id);
export function attachFilesToMessage(projectId: string, messageId: string, fileIds: string[]) {
  const st = db.prepare("UPDATE files SET message_id = ? WHERE id = ? AND project_id = ? AND message_id IS NULL");
  for (const f of fileIds) st.run(messageId, f, projectId);
}
export function getFileRow(id: string) {
  return db.prepare("SELECT * FROM files WHERE id = ?").get(id) as FileRow | undefined;
}
export function contextFiles(projectId: string) {
  return db.prepare("SELECT * FROM files WHERE project_id = ? AND in_context = 1 ORDER BY created_at").all(projectId) as FileRow[];
}
export function messageFiles(projectId: string) {
  return db.prepare("SELECT * FROM files WHERE project_id = ? AND message_id IS NOT NULL ORDER BY created_at").all(projectId) as FileRow[];
}
export const setFileInContext = (id: string, v: boolean) => db.prepare("UPDATE files SET in_context = ? WHERE id = ?").run(v ? 1 : 0, id);
export function deleteFile(id: string) {
  const f = getFileRow(id);
  if (f) {
    for (const p of [f.stored_path, f.stored_path + ".ctx.webp"]) { try { fs.unlinkSync(p); } catch {} }
    try { fs.rmSync(f.stored_path + ".video", { recursive: true, force: true }); } catch {}
  }
  db.prepare("DELETE FROM files WHERE id = ?").run(id);
}
