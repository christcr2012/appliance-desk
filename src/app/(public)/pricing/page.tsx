import { redirect } from "next/navigation";
import { getLaunchSettings } from "@/domains/launch";
import type { Metadata } from "next";
import { Container } from "@/components/site/container";
import { Card } from "@/components/ui";
import { SiteCta } from "@/components/site/site-cta";
import { RichText } from "@/components/site/rich-text";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedCatalog, formatCents } from "@/domains/pricing";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { launchPath } from "@/domains/site-content/launch-path";
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
  searchParams: Promise<{ revision?: string | string[]; previewAt?: string | string[]; select?: string | string[] }>;
}) {
  if ((await getLaunchSettings()).prelaunchMode) redirect(launchPath(await searchParams));
  const [settings, applianceTypes, site] = await Promise.all([
    getBusinessSettings(),
    getPublishedCatalog(),
    searchParams.then(getSiteForRequest),
  ]);
  const content = site.text;
  const facts = siteFacts(settings);
  const c = siteCopy(content, facts);
  const profile = { phone: settings.publicPhone, email: settings.publicEmail };

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
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            {c("pricing.heading")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            <RichText text={c("pricing.intro")} />
          </p>
        </Container>
      </section>

      <Container className="py-16 md:py-20">
        {applianceTypes.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {applianceTypes.map((type) => (
              <Card key={`${type.kind}-${type.id}`} className="flex flex-col">
                <ApplianceMedia
                  photoUrl={type.photoUrl}
                  name={type.name}
                  alt={catalogAlt(content, type.slug, type.name)}
                  className="h-40 w-full rounded-control object-cover"
                  iconClassName="h-16 w-auto text-primary"
                />
                <h2 className="mt-5 font-display text-xl font-semibold text-ink">
                  {type.name}
                </h2>
                <p className="mt-2 text-3xl font-semibold text-ink">
                  {formatCents(type.monthlyPriceCents)}
                  <span className="text-base font-normal text-ink-faint">
                    {" "}
                    {c("price.perMonth")}
                  </span>
                </p>
                {type.contents && (
                  <p className="mt-2 text-sm text-ink-soft">{c("pricing.card.includes", { contents: type.contents })}</p>
                )}
                {type.savingCents ? (
                  <p className="mt-2 text-sm font-medium text-accent-dark">
                    {c("pricing.card.saving", { amount: formatCents(type.savingCents) })}
                  </p>
                ) : null}
                <div className="mt-6">
                  <SiteCta value={siteLinkValue(site.values, "pricing.card.cta")} profile={profile} facts={facts} variant="secondary" className="w-full" />
                </div>
              </Card>
            ))}
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
            <h2 className="font-display text-2xl font-semibold text-ink">
              {c("pricing.fees.heading")}
            </h2>
            <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
              {fees.map((fee) => (
                <div
                  key={fee.label}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <dt className="text-ink-soft">{fee.label}</dt>
                  <dd className="font-semibold text-ink">{fee.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">
              {c("pricing.good.heading")}
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-ink-soft">
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
