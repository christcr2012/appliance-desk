import { SelectBridge } from "@/components/site/select-bridge";
import { redirect } from "next/navigation";
import { getLaunchSettings } from "@/domains/launch";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/site/container";
import { Card } from "@/components/ui";
import { SiteCta } from "@/components/site/site-cta";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedCatalog, formatCents } from "@/domains/pricing";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue, stripInlineLinks } from "@/domains/site-content/facts";

// ---------------------------------------------------------------------------
// Simple local-search landing pages (2026-09-28, Task #46 — see
// docs/reviews/2026-09-27-business-growth-ideas.md idea #11). One page per
// city Chris has actually listed in Settings' service area
// (BusinessSettings.serviceAreaCities) — never a made-up city, and never
// fabricated local claims (no invented review counts or "we've served
// hundreds of families in X" language). It's the same real pricing/appliance
// content as /pricing, just addressed to one city at a time so a search for
// "appliance rental in <city>" has a page that actually answers it.
// ---------------------------------------------------------------------------

function slugifyCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

async function findCity(citySlug: string): Promise<string | null> {
  const settings = await getBusinessSettings();
  const { cities } = parseServiceArea(settings);
  return cities.find((city) => slugifyCity(city) === citySlug) ?? null;
}

export async function generateStaticParams() {
  const settings = await getBusinessSettings();
  const { cities } = parseServiceArea(settings);
  return cities.map((city) => ({ city: slugifyCity(city) }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ city: string }>;
}): Promise<Metadata> {
  if ((await getLaunchSettings()).prelaunchMode) redirect("/launch");
  const { city: citySlug } = await params;
  const city = await findCity(citySlug);
  if (!city) {
    return { title: "Service Area" };
  }
  const [settings, content] = await Promise.all([getBusinessSettings(), getPublishedContent()]);
  const c = siteCopy(content, siteFacts(settings, { city }));
  return {
    title: stripInlineLinks(c("seo.rent.title")),
    description: stripInlineLinks(c("seo.rent.description")),
  };
}

export default async function CityLandingPage({
  params,
  searchParams,
}: {
  params: Promise<{ city: string }>;
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  if ((await getLaunchSettings()).prelaunchMode) redirect("/launch");
  const { city: citySlug } = await params;
  const city = await findCity(citySlug);
  if (!city) {
    notFound();
  }

  const [settings, applianceTypes, site] = await Promise.all([
    getBusinessSettings(),
    getPublishedCatalog(),
    searchParams.then(getSiteForRequest),
  ]);
  const facts = siteFacts(settings, { city });
  const c = siteCopy(site.text, facts);
  const profile = { phone: settings.publicPhone, email: settings.publicEmail };

  return (
    <>
      <SelectBridge site={site} />
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            {c("rent.heading")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            {c("rent.intro")}
          </p>
          <div className="mt-8">
            <SiteCta value={siteLinkValue(site.values, "rent.cta.top")} profile={profile} facts={facts} />
          </div>
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
                {type.savingCents ? (
                  <p className="mt-2 text-sm font-medium text-accent-dark">
                    {c("price.saving", { contents: type.contents ?? "", amount: formatCents(type.savingCents) })}
                  </p>
                ) : null}
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-ink-soft">
            {c("rent.empty")}
          </p>
        )}

        <div className="mt-16">
          <Card className="text-center">
          <h2 className="font-display text-xl font-semibold text-ink">
            {c("rent.serving.heading")}
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-ink-soft">
            {c("rent.serving.body")}
          </p>
          {settings.publicPhone && !settings.publicPhone.startsWith("[") && (
            <p className="mt-4 text-ink-soft">{c("rent.call")}</p>
          )}
          <div className="mt-6">
            <SiteCta value={siteLinkValue(site.values, "rent.cta.bottom")} profile={profile} facts={facts} />
          </div>
          </Card>
        </div>
      </Container>
    </>
  );
}
