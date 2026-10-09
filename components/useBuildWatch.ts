"use client";
import { useEffect, useRef, useState } from "react";

/** Build id of the HTML this tab was loaded from (rendered per request into <meta name="room-build">). */
export const pageBuildId = () =>
  typeof document === "undefined" ? "" : document.querySelector('meta[name="room-build"]')?.getAttribute("content") || "";

/**
 * Detects a new build going live without a manual reload:
 * - polls /api/health every 30s and whenever the tab regains focus;
 * - if the server's build id differs from this tab's, reloads right away when idle (canReload()), otherwise
 *   reports `newBuild` so the UI can offer a Reload button;
 * - `stale` = the server process itself is older than the build on disk (someone ran `npm run build` without
 *   restarting it) — that needs `npm run restart`, a browser reload can't fix it;
 * - a failed chunk load (old tab asking for files of a replaced build) triggers a reload.
 */
export function useBuildWatch(canReload: () => boolean) {
  const [newBuild, setNewBuild] = useState(false);
  const [stale, setStale] = useState(false);
  const canRef = useRef(canReload);
  canRef.current = canReload;

  useEffect(() => {
    const mine = pageBuildId();
    let timer: ReturnType<typeof setInterval>;
    const check = async () => {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!r.ok) return;
        const h = (await r.json()) as { buildId?: string; stale?: boolean };
        setStale(!!h.stale);
        if (mine && h.buildId && h.buildId !== mine) {
          if (canRef.current()) location.reload();
          else setNewBuild(true);
        }
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === "visible") check(); };
    const onErr = (e: ErrorEvent | PromiseRejectionEvent) => {
      const msg = String(("reason" in e ? e.reason?.message : e.message) || "");
      if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module|Importing a module script failed/i.test(msg)) location.reload();
    };
    check();
    timer = setInterval(check, 30_000);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onErr);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onErr);
    };
  }, []);

  return { newBuild, stale };
}
