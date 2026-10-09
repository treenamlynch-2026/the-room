import type { NextConfig } from "next";

const NO_STORE = [{ key: "Cache-Control", value: "no-store, must-revalidate" }];

const config: NextConfig = {
  serverExternalPackages: ["sharp", "ffmpeg-static"],
  // Display name only (not a secret): used by "Copy latest" in the browser.
  env: { NEXT_PUBLIC_HUMAN_NAME: process.env.HUMAN_NAME || "Human" },
  // HTML and API responses must never be cached, so an update can't serve an old page that points at old code.
  // /_next/static/* keeps Next's own "immutable" caching: those file names are content-hashed per build.
  async headers() {
    return [
      { source: "/", headers: NO_STORE },
      { source: "/api/:path((?!files/).*)", headers: NO_STORE }, // uploaded files are immutable by id: leave cacheable
    ];
  },
};
export default config;
