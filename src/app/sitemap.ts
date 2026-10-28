import { getLaunchSettings } from "@/domains/launch";
import type { MetadataRoute } from "next";
import { getBusinessSettings } from "@/domains/settings";
import { townsWithZones } from "@/domains/delivery/towns";
import { readZoneSettings } from "@/domains/delivery/zone";
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

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const settings = await getBusinessSettings();
  const launch = await getLaunchSettings();
  const legalApprovals = (settings as { legalApprovals?: unknown }).legalApprovals;
  const approvedLegalRoutes = [
    ...(isLegalPageApproved(legalApprovals, "privacy", LEGAL_PAGE_VERSIONS.privacy)
      ? ["/privacy"]
      : []),
    ...(isLegalPageApproved(legalApprovals, "terms", LEGAL_PAGE_VERSIONS.terms)
      ? ["/terms"]
      : []),
  ];

  const staticRoutes = [...PUBLIC_ROUTES.filter((route) => !launch.prelaunchMode || route !== "/pricing"), ...approvedLegalRoutes].map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: route === "" ? ("weekly" as const) : ("monthly" as const),
    priority: route === "" ? 1 : 0.7,
  }));

  // One entry per town in a delivery zone (ZONE-1 town list) — see
  // /rent/[city] ("Simple local-search landing pages," Task #46).
  const towns = townsWithZones(readZoneSettings(settings)).filter((town) => town.zone.kind === "ZONE");
  const cityRoutes = (launch.prelaunchMode ? [] : towns).map((town) => ({
    url: `${baseUrl}/rent/${town.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [...staticRoutes, ...cityRoutes];
}
