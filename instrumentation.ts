/** Runs once when the server process starts (Node runtime only). */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./lib/boot");
}
