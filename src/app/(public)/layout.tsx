import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import {
  isLegalPageApproved,
  LEGAL_PAGE_VERSIONS,
} from "@/domains/settings/legal-approvals";
import { PublicChrome } from "@/components/site/public-chrome";
import { getSiteForRequest } from "@/domains/site-content/request";
import { MetricoolTracker } from "@/components/site/metricool-tracker";
import { metricoolConfig } from "@/lib/metricool";
import { getLaunchSettings } from "@/domains/launch";

// Shared chrome for every public marketing page (home, pricing,
// how-it-works, service-area, contact, and the legal pages) — never
// rendered on /login, /desk/**, or /account/**, which each have their own
// minimal layout. See docs/ARCHITECTURE.md's folder-layout note: route
// groups like (public) organize files without adding a URL segment.
export default async function PublicLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, launch, site] = await Promise.all([
    getBusinessSettings(),
    getLaunchSettings(),
    getSiteForRequest(),
  ]);
  const serviceArea = parseServiceArea(settings);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const tracking = metricoolConfig(process.env.VERCEL_ENV, process.env.METRICOOL_TRACKING_HASH, baseUrl);
  const legalApprovals = (settings as { legalApprovals?: unknown }).legalApprovals;
  const privacyApproved = isLegalPageApproved(
    legalApprovals,
    "privacy",
    LEGAL_PAGE_VERSIONS.privacy,
  );
  const termsApproved = isLegalPageApproved(
    legalApprovals,
    "terms",
    LEGAL_PAGE_VERSIONS.terms,
  );

  // Local SEO structured data (schema.org LocalBusiness) — helps search
  // engines and map/voice-assistant results show accurate name, contact
  // info, and service area. Sourced entirely from BusinessSettings, so it
  // stays correct if Chris edits business info in /desk/settings.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: settings.publicBusinessName,
    telephone: settings.publicPhone,
    email: settings.publicEmail,
    address: {
      "@type": "PostalAddress",
      streetAddress: settings.publicAddress,
      addressRegion: "CO",
      addressCountry: "US",
    },
    areaServed: serviceArea.cities,
    url: baseUrl,
    ...(!launch.prelaunchMode ? { priceRange: "$$" } : {}),
  };

  return (
    <>
      {tracking && <MetricoolTracker {...tracking} />}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <PublicChrome
        site={site}
        settings={settings}
        prelaunch={launch.prelaunchMode}
        privacyApproved={privacyApproved}
        termsApproved={termsApproved}
      >
        {children}
      </PublicChrome>
    </>
  );
}
