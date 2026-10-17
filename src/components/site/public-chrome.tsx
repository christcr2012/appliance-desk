import { Header, type HeaderCta } from "./header";
import { Footer } from "./footer";
import { RichText } from "./rich-text";
import { PromotionBanner } from "./promotion-banner";
import { PreviewBridge } from "./preview-bridge";
import { SITE_KEYS } from "@/domains/site-content/preview-markers";
import { siteFacts, siteLinkValue } from "@/domains/site-content/facts";
import { fillSiteText } from "@/domains/site-content/fields";
import { linkRel, resolveLinkHref } from "@/domains/site-content/links";
import type { SiteRequest } from "@/domains/site-content/request";

type ChromeSettings = {
  publicBusinessName: string;
  publicPhone: string;
  publicEmail: string;
  publicAddress: string;
  hours?: unknown;
  holidayClosures?: unknown;
  socialLinks?: unknown;
};

/**
 * Menu, notice bar, promotion banner and footer, built from one website-content read so the owner's preview shows the
 * same frame visitors get (V-C3).
 */
export function PublicChrome({
  site,
  settings,
  prelaunch,
  privacyApproved,
  termsApproved,
  children,
}: {
  site: SiteRequest;
  settings: ChromeSettings;
  prelaunch: boolean;
  privacyApproved: boolean;
  termsApproved: boolean;
  children: React.ReactNode;
}) {
  const profile = { phone: settings.publicPhone || null, email: settings.publicEmail || null };
  const facts = siteFacts(settings);
  const ctaValue = siteLinkValue(site.values, prelaunch ? "header.cta.prelaunch" : "header.cta.live");
  const ctaHref = ctaValue ? resolveLinkHref(ctaValue.target, profile) : null;
  const cta: HeaderCta | null =
    ctaValue && ctaHref ? { label: fillSiteText(ctaValue.label, facts), href: ctaHref, rel: linkRel(ctaValue.target) } : null;
  const notice = site.text["launch.notice"];

  return (
    <>
      {site.selectable && site.revisionId ? <PreviewBridge keys={SITE_KEYS} revisionId={site.revisionId} /> : null}
      <PromotionBanner value={site.values["site.banner.promotion"]} now={site.now} profile={profile} facts={facts} />
      <Header businessName={settings.publicBusinessName} prelaunch={prelaunch} text={site.text} cta={cta} />
      {prelaunch && notice ? (
        <p className="bg-primary-soft px-4 py-3 text-center text-sm text-primary-dark">
          <RichText text={fillSiteText(notice, facts)} linkClassName="font-semibold underline" />
        </p>
      ) : null}
      <main id="main-content" className="flex-1">
        {children}
      </main>
      <Footer
        text={site.text}
        prelaunch={prelaunch}
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
