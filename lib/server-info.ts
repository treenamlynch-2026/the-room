import fs from "node:fs";
import path from "node:path";

const BUILD_ID_FILE = path.join(process.cwd(), ".next", "BUILD_ID");
const read = () => { try { return fs.readFileSync(BUILD_ID_FILE, "utf8").trim(); } catch { return "unknown"; } };

const g = globalThis as unknown as { __roomServer?: { buildId: string; startedAt: string } };
/** The build this process loaded at start. If .next/BUILD_ID on disk differs, someone rebuilt under a running server. */
export const server = (g.__roomServer ??= { buildId: read(), startedAt: new Date().toISOString() });
export const diskBuildId = read;
