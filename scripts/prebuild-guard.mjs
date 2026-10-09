// Refuse `npm run build` while a Room server is running on :3000. Building replaces .next under the live
// process, which then serves a mix of old and new code (the "stale code after updates" bug).
// Use `npm run restart` (stops, builds, starts) instead. Override: set ALLOW_BUILD_WHILE_RUNNING=1.
import net from "node:net";

if (process.env.ROOM_RESTARTING === "1" || process.env.ALLOW_BUILD_WHILE_RUNNING === "1") process.exit(0);
const port = Number(process.env.PORT) || 3000;
const busy = await new Promise((resolve) => {
  const s = net.connect({ host: "127.0.0.1", port });
  s.setTimeout(800);
  s.on("connect", () => { s.destroy(); resolve(true); });
  s.on("timeout", () => { s.destroy(); resolve(false); });
  s.on("error", () => resolve(false));
});
if (busy) {
  console.error(`\nA server is running on port ${port}. Building now would leave it serving stale code.\n` +
    `Run "npm run restart" instead (stops it, builds, starts a fresh one), or set ALLOW_BUILD_WHILE_RUNNING=1.\n`);
  process.exit(1);
}
