import type { MetadataRoute } from "next";

// /desk/** and /account/** are deliberately excluded — they're
// noindex/nofollow (see next.config.ts and docs/DESIGN-SYSTEM.md) and
// should never appear in a sitemap search engines crawl.
const PUBLIC_ROUTES = [
  "",
  "/pricing",
  "/how-it-works",
  "/service-area",
  "/contact",
  "/privacy",
  "/terms",
  "/accessibility",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return PUBLIC_ROUTES.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? "weekly" : "monthly",
    priority: route === "" ? 1 : 0.7,
  }));
}
