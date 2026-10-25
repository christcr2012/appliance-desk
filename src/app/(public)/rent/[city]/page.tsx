import { SelectBridge } from "@/components/site/select-bridge";
import { redirect } from "next/navigation";
import { getLaunchSettings } from "@/domains/launch";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import { Container } from "@/components/site/container";
import { PageHero } from "@/components/site/page-hero";
import { Card } from "@/components/ui";
import { SiteCta } from "@/components/site/site-cta";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { TOWNS, townBySlug, townSlug } from "@/domains/delivery/towns";
import { readZoneSettings, zoneForPoint } from "@/domains/delivery/zone";
import { getPublishedCatalog, formatCents } from "@/domains/pricing";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue, stripInlineLinks } from "@/domains/site-content/facts";

// ---------------------------------------------------------------------------
// Simple local-search landing pages (2026-09-28, Task #46 — see
// docs/reviews/2026-09-27-business-growth-ideas.md idea #11). ZONE-1: one page
// per town on the delivery-zone town list (src/domains/delivery/towns.ts, from
// the 2026-10-25 research) with the zone its center is in — never a made-up
// town, and never fabricated local claims. Same slugs as the old owner city
// list, so old links keep working; an old listed city that isn't on the town
// list goes to the service area page instead of a dead end.
// ---------------------------------------------------------------------------

async function findCity(citySlug: string): Promise<string | null> {
  return townBySlug(citySlug)?.name ?? null;
}

async function legacyCitySlug(citySlug: string): Promise<boolean> {
  const { cities } = parseServiceArea(await getBusinessSettings());
  return cities.some((city) => townSlug(city) === citySlug);
}

export async function generateStaticParams() {
  return TOWNS.map((town) => ({ city: town.slug }));
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
    if (await legacyCitySlug(citySlug)) permanentRedirect("/service-area");
    notFound();
  }
  const town = townBySlug(citySlug)!;

  const [settings, applianceTypes, site] = await Promise.all([
    getBusinessSettings(),
    getPublishedCatalog(),
    searchParams.then(getSiteForRequest),
  ]);
  const facts = siteFacts(settings, { city });
  const c = siteCopy(site.text, facts);
  const profile = { phone: settings.publicPhone, email: settings.publicEmail };
  const zone = zoneForPoint({ lat: town.lat, lon: town.lon }, readZoneSettings(settings));

  return (
    <>
      <SelectBridge site={site} />
      <PageHero heading={c("rent.heading")} lede={c("rent.intro")} />
      <Container className="pt-10 md:pt-14">
        <SiteCta value={siteLinkValue(site.values, "rent.cta.top")} profile={profile} facts={facts} />
      </Container>

      <Container className="py-12 md:py-16">
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
          <p className="mx-auto mt-3 max-w-xl font-semibold text-ink">
            {zone.kind === "ZONE" ? c("rent.zone", { zone: zone.name }) : c("rent.zone.outside")}
          </p>
          <p className="mx-auto mt-2 max-w-xl text-ink-soft">
            {c("rent.serving.body")}
          </p>
          <div className="mt-3">
            <SiteCta value={siteLinkValue(site.values, "rent.zone.cta")} profile={profile} facts={facts} textStyle />
          </div>
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
