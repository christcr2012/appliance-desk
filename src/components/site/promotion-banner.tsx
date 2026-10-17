import { SiteCta } from "./site-cta";
import { livePromotion } from "@/domains/site-content/promotions";
import { fillSiteText, type SiteTextFacts } from "@/domains/site-content/fields";
import type { SiteValue } from "@/domains/site-content/types";

/** The site-wide promotion banner. Shows only while the owner's Colorado-time window is open; otherwise nothing at all. */
export function PromotionBanner({
  value,
  now,
  profile,
  facts,
}: {
  value: SiteValue | undefined;
  now: Date;
  profile: { phone: string | null; email: string | null };
  facts: SiteTextFacts;
}) {
  const promo = livePromotion(value?.kind === "promotion" ? value : undefined, now);
  if (!promo) return null;
  return (
    <div role="region" aria-label="Promotion" className="bg-accent-soft px-4 py-3 text-center text-sm text-ink">
      <span className="font-semibold">{fillSiteText(promo.title, facts)}</span>
      {promo.body ? <span> {fillSiteText(promo.body, facts)}</span> : null}
      {promo.cta ? (
        <>
          {" "}
          <SiteCta value={promo.cta} profile={profile} facts={facts} textStyle />
        </>
      ) : null}
    </div>
  );
}
