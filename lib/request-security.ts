/** Validate the local address and browser origin before any application work. */
export function requestProblem(req: Request, port = process.env.PORT || "3000"): string | null {
  const host = req.headers.get("host")?.toLowerCase();
  if (!host || !new Set([`127.0.0.1:${port}`, `localhost:${port}`]).has(host)) return "Unrecognized host";
  const origin = req.headers.get("origin");
  if (origin && origin !== `http://${host}`) return "Unrecognized origin";
  if (req.headers.get("sec-fetch-site") === "cross-site") return "Cross-site request rejected";
  if (new URL(req.url).pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    if (!origin) return "Origin required";
    const type = req.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    const upload = /^\/api\/projects\/[^/]+\/files$/.test(new URL(req.url).pathname) && req.method === "POST";
    if (upload ? type !== "multipart/form-data" : type !== "application/json") return "Unsupported content type";
  }
  return null;
}
