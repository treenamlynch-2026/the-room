"use client";
import type { StreamEvent } from "@/lib/types";

/** The browser could not reach the Room server (stopped, restarting, or the connection dropped mid-stream). */
export class ServerUnreachable extends Error {
  /** sent=false: the request never reached the server (safe to resend). */
  constructor(msg = "Lost connection to the Room server", readonly sent = true) { super(msg); this.name = "ServerUnreachable"; }
}
export const isUnreachable = (e: unknown): e is ServerUnreachable => e instanceof ServerUnreachable;

async function doFetch(url: string, init: RequestInit) {
  try { return await fetch(url, { cache: "no-store", ...init }); }
  catch { throw new ServerUnreachable("The Room server is unreachable", false); } // fetch only rejects on network failure
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await doFetch(url, {
    method: opts.method || (opts.body !== undefined ? "POST" : "GET"),
    headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || res.statusText);
  return data as T;
}

/** POST and consume a server-sent-event stream. Throws ServerUnreachable if the connection drops before the "end" event. */
export async function streamPost(url: string, body: unknown, onEvent: (e: StreamEvent) => void) {
  const res = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || res.statusText);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", ended = false;
  for (;;) {
    let r: Awaited<ReturnType<typeof reader.read>>;
    try { r = await reader.read(); } catch { throw new ServerUnreachable("Connection to the Room server dropped mid-reply"); }
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      if (chunk.startsWith("data: ")) {
        try {
          const ev = JSON.parse(chunk.slice(6)) as StreamEvent;
          if (ev.type === "end") ended = true;
          onEvent(ev);
        } catch {}
      }
    }
  }
  if (!ended) throw new ServerUnreachable("Connection to the Room server dropped mid-reply");
}
