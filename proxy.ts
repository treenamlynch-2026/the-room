import { NextResponse, type NextRequest } from "next/server";

/** Optional single-user password (HTTP Basic). With APP_PASSWORD unset, the app relies on binding to 127.0.0.1. */
export function proxy(req: NextRequest) {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return NextResponse.next();
  const h = req.headers.get("authorization") || "";
  const given = h.startsWith("Basic ") ? atob(h.slice(6)).split(":").slice(1).join(":") : null;
  if (given === pw) return NextResponse.next();
  return new NextResponse("Authentication required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="The Room"' } });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
