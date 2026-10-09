import { server } from "./server-info";
import { warnShadowedKeys } from "./keys";
import "./db"; // opens the DB now, which also marks replies interrupted by the last shutdown as retryable

console.log(`[room] ${server.startedAt} server started pid=${process.pid} build=${server.buildId}${process.env.MOCK_AGENTS === "1" ? " MOCK_AGENTS" : ""}${process.env.ROOM_DATA_DIR ? ` data=${process.env.ROOM_DATA_DIR}` : ""}`);
warnShadowedKeys();
