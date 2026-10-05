import type { MetadataRoute } from "next";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import {
  isLegalPageApproved,
  LEGAL_PAGE_VERSIONS,
} from "@/domains/settings/legal-approvals";

// /desk/** and /account/** are deliberately excluded — they're
// noindex/nofollow (see next.config.ts and docs/DESIGN-SYSTEM.md) and
// should never appear in a sitemap search engines crawl.
const PUBLIC_ROUTES = [
  "",
  "/pricing",
  "/how-it-works",
  "/service-area",
  "/contact",
  "/launch",
  "/accessibility",
];

function slugifyCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const settings = await getBusinessSettings();
  const legalApprovals = (settings as { legalApprovals?: unknown }).legalApprovals;
  const approvedLegalRoutes = [
    ...(isLegalPageApproved(legalApprovals, "privacy", LEGAL_PAGE_VERSIONS.privacy)
      ? ["/privacy"]
      : []),
    ...(isLegalPageApproved(legalApprovals, "terms", LEGAL_PAGE_VERSIONS.terms)
      ? ["/terms"]
      : []),
  ];

  const staticRoutes = [...PUBLIC_ROUTES, ...approvedLegalRoutes].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? ("weekly" as const) : ("monthly" as const),
    priority: route === "" ? 1 : 0.7,
  }));

  // One entry per real service-area city (Settings' service area) — see
  // /rent/[city] ("Simple local-search landing pages," Task #46).
  const { cities } = parseServiceArea(settings);
  const cityRoutes = cities.map((city) => ({
    url: `${baseUrl}/rent/${slugifyCity(city)}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...cityRoutes];
}
