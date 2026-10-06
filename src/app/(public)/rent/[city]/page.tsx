import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Container } from "@/components/site/container";
import { ButtonLink, Card } from "@/components/ui";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedApplianceTypes, formatCents } from "@/domains/pricing";

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
  const { city: citySlug } = await params;
  const city = await findCity(citySlug);
  if (!city) {
    return { title: "Service Area" };
  }
  const settings = await getBusinessSettings();
  return {
    title: `Appliance Rental in ${city}, CO`,
    description: `Washer and dryer rentals in ${city}, Colorado from ${settings.publicBusinessName} — delivery, installation, and repairs included.`,
  };
}

export default async function CityLandingPage({
  params,
}: {
  params: Promise<{ city: string }>;
}) {
  const { city: citySlug } = await params;
  const city = await findCity(citySlug);
  if (!city) {
    notFound();
  }

  const [settings, applianceTypes] = await Promise.all([
    getBusinessSettings(),
    getPublishedApplianceTypes(),
  ]);

  return (
    <>
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            Appliance rental in {city}, Colorado
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            {settings.publicBusinessName} delivers, installs, and services
            washers and dryers for {city} renters and homeowners — no
            purchase, no long-term commitment required, and repairs are
            covered by us for as long as you rent.
          </p>
          <div className="mt-8">
            <ButtonLink href="/contact" variant="primary">
              Get a quote for {city}
            </ButtonLink>
          </div>
        </Container>
      </section>

      <Container className="py-16 md:py-20">
        {applianceTypes.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {applianceTypes.map((type) => (
              <Card key={type.id} className="flex flex-col">
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
                    / month
                  </span>
                </p>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-ink-soft">
            Pricing is being finalized — send us your address on the quote
            form and we&apos;ll confirm what&apos;s available in {city}.
          </p>
        )}

        <div className="mt-16">
          <Card className="text-center">
          <h2 className="font-display text-xl font-semibold text-ink">
            Serving {city} and the surrounding area
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-ink-soft">
            Not sure if your exact address is covered yet? Ask on the quote
            form and we&apos;ll tell you honestly — we&apos;re growing our
            service area over time.
          </p>
          {settings.publicPhone && !settings.publicPhone.startsWith("[") && (
            <p className="mt-4 text-ink-soft">Call us at {settings.publicPhone}</p>
          )}
          <div className="mt-6">
            <ButtonLink href="/contact">
              Check your address in {city}
            </ButtonLink>
          </div>
          </Card>
        </div>
      </Container>
    </>
  );
}
