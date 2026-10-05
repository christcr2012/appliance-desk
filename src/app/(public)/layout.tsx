import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import {
  isLegalPageApproved,
  LEGAL_PAGE_VERSIONS,
} from "@/domains/settings/legal-approvals";
import { Header } from "@/components/site/header";
import { Footer } from "@/components/site/footer";
import Link from "next/link";
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
  const [settings, launch] = await Promise.all([
    getBusinessSettings(),
    getLaunchSettings(),
  ]);
  const serviceArea = parseServiceArea(settings);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
    priceRange: "$$",
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <Header
        businessName={settings.publicBusinessName}
        prelaunch={launch.prelaunchMode}
      />
      {launch.prelaunchMode && (
        <p className="bg-primary-soft px-4 py-3 text-center text-sm text-primary-dark">
          We&apos;re preparing to launch in Greeley and the surrounding area.{" "}
          <Link href="/launch" className="font-semibold underline">
            Join for updates
          </Link>
          .
        </p>
      )}
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer
        businessName={settings.publicBusinessName}
        phone={settings.publicPhone}
        email={settings.publicEmail}
        address={settings.publicAddress}
        hours={settings.hours}
        holidayClosures={settings.holidayClosures}
        socialLinks={settings.socialLinks}
        privacyApproved={privacyApproved}
        termsApproved={termsApproved}
      />
    </>
  );
}
