import "./globals.css";
import type { Metadata, Viewport } from "next";
import { server } from "@/lib/server-info";

export const metadata: Metadata = { title: "The Room" };
export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#0E131A" };
// Rendered per request (never a cached/prerendered HTML shell), so the page always matches the running build.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="room-build" content={server.buildId} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
