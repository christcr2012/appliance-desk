import { SelectBridge } from "@/components/site/select-bridge";
import { redirect } from "next/navigation";
import { getLaunchSettings } from "@/domains/launch";
import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { PageHero } from "@/components/site/page-hero";
import { SiteCta } from "@/components/site/site-cta";
import { RichText } from "@/components/site/rich-text";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedCatalog, formatCents } from "@/domains/pricing";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue } from "@/domains/site-content/facts";
import { catalogAlt } from "@/domains/site-content/fields";

export async function generateMetadata(): Promise<Metadata> {
  if ((await getLaunchSettings()).prelaunchMode) {
    return { title: "Launch updates", robots: { index: false, follow: false } };
  }
  const content = await getPublishedContent();
  return { title: content["seo.pricing.title"], description: content["seo.pricing.description"] };
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  if ((await getLaunchSettings()).prelaunchMode) redirect("/launch");
  const [settings, applianceTypes, site] = await Promise.all([
    getBusinessSettings(),
    getPublishedCatalog(),
    searchParams.then(getSiteForRequest),
  ]);
  const content = site.text;
  const facts = siteFacts(settings);
  const c = siteCopy(content, facts);
  const profile = { phone: settings.publicPhone, email: settings.publicEmail };
  const featured = applianceTypes.find((item) => item.kind === "package") ?? null;

  const fees = [
    { label: c("pricing.fee.delivery"), cents: settings.oneTimeDeliveryFeeCents },
    { label: c("pricing.fee.installation"), cents: settings.oneTimeInstallationFeeCents },
    { label: c("pricing.fee.removal"), cents: settings.oneTimeRemovalFeeCents },
  ].map((fee) => ({
    label: fee.label,
    value: fee.cents > 0 ? formatCents(fee.cents) : c("pricing.fee.none"),
  }));

  return (
    <>
      <SelectBridge site={site} />
      <PageHero heading={c("pricing.heading")} lede={<RichText text={c("pricing.intro")} />} />

      <Container className="py-16 md:py-20">
        {applianceTypes.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {applianceTypes.map((type) => {
              const isFeatured = featured !== null && type.kind === featured.kind && type.id === featured.id;
              return (
                <div
                  key={`${type.kind}-${type.id}`}
                  className={`flex flex-col p-5 ${
                    isFeatured
                      ? "cut-corner-md bg-primary text-on-primary dark:border-2 dark:border-primary dark:bg-surface dark:text-ink"
                      : "rounded-card border border-hairline bg-surface text-ink"
                  }`}
                >
                  <ApplianceMedia
                    photoUrl={type.photoUrl}
                    name={type.name}
                    alt={catalogAlt(content, type.slug, type.name)}
                    className="h-44 w-full rounded-control bg-surface object-cover"
                    iconClassName="h-16 w-auto text-primary"
                  />
                  <h2 className="mt-5 text-h3">{type.name}</h2>
                  <p className="mt-2 text-price tabular-nums">
                    {formatCents(type.monthlyPriceCents)}
                    <span className="text-sm font-normal tracking-normal opacity-80"> {c("price.perMonth")}</span>
                  </p>
                  {type.contents && (
                    <p className="mt-2 text-sm opacity-90">{c("pricing.card.includes", { contents: type.contents })}</p>
                  )}
                  {type.savingCents ? (
                    <p className="mt-2 text-sm font-semibold">
                      {c("pricing.card.saving", { amount: formatCents(type.savingCents) })}
                    </p>
                  ) : null}
                  <div className="mt-6">
                    <SiteCta
                      value={siteLinkValue(site.values, "pricing.card.cta")}
                      profile={profile}
                      facts={facts}
                      variant="secondary"
                      className="w-full"
                    />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-ink-soft">
            <RichText text={c("pricing.empty")} />
          </p>
        )}

        <p className="mt-8 text-sm text-ink-faint">
          {c("price.illustrationNote")}
        </p>

        <div className="mt-16 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="text-h2 text-ink">
              {c("pricing.fees.heading")}
            </h2>
            <dl className="mt-6 divide-y divide-hairline border-y border-hairline">
              {fees.map((fee) => (
                <div
                  key={fee.label}
                  className="flex items-center justify-between py-4"
                >
                  <dt className="text-ink-soft">{fee.label}</dt>
                  <dd className="text-h3 tabular-nums text-ink">{fee.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="text-h2 text-ink">
              {c("pricing.good.heading")}
            </h2>
            <ul className="mt-6 divide-y divide-hairline border-y border-hairline text-ink-soft [&>li]:py-4">
              <li>
                <span className="font-medium text-ink">{c("pricing.good.terms.label")}</span>{" "}
                {c("pricing.good.terms.text")}
              </li>
              {settings.depositEnabled && (
                <li>
                  <span className="font-medium text-ink">
                    {c("pricing.good.deposit.label")}
                  </span>{" "}
                  {c("pricing.good.deposit.text")}
                </li>
              )}
              {settings.damageWaiverEnabled && (
                <li>
                  <span className="font-medium text-ink">
                    {c("pricing.good.waiver.label")}
                  </span>{" "}
                  {c("pricing.good.waiver.text")}
                </li>
              )}
              <li>
                <span className="font-medium text-ink">{c("pricing.good.tax.label")}</span>{" "}
                {c("pricing.good.tax.text")}
              </li>
              <li>
                <span className="font-medium text-ink">{c("pricing.good.late.label")}</span>{" "}
                {c("pricing.good.late.text")}
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 text-center">
          <SiteCta value={siteLinkValue(site.values, "pricing.cta")} profile={profile} facts={facts} />
        </div>
      </Container>
    </>
  );
}
