import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { requestProblem } from "./lib/request-security";

/** Optional single-user password (HTTP Basic). With APP_PASSWORD unset, the app relies on binding to 127.0.0.1. */
export function proxy(req: NextRequest) {
  const problem = requestProblem(req);
  if (problem) return new NextResponse(problem, { status: 403 });
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const h = req.headers.get("authorization") || "";
  let given: string | null = null;
  try { given = h.startsWith("Basic ") ? atob(h.slice(6)).split(":").slice(1).join(":") : null; } catch { /* malformed input */ }
  const digest = (s: string) => createHash("sha256").update(s).digest();
  if (given !== null && timingSafeEqual(digest(given), digest(pw))) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="The Room"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
