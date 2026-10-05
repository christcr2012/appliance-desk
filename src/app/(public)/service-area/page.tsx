import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { ButtonLink } from "@/components/site/button-link";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedContent } from "@/domains/site-content";

function slugifyCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.service-area.title"], description: content["seo.service-area.description"] };
}

export default async function ServiceAreaPage() {
  const settings = await getBusinessSettings();
  const { cities, zips } = parseServiceArea(settings);

  return (
    <>
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            Service area
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            We&apos;re growing — not sure if we cover your address yet? Ask
            us on the quote form and we&apos;ll tell you honestly.
          </p>
        </Container>
      </section>

      <Container className="py-16 md:py-20">
        {cities.length > 0 || zips.length > 0 ? (
          <div className="grid gap-10 md:grid-cols-2">
            {cities.length > 0 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">
                  Cities we serve
                </h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {cities.map((city) => (
                    <li key={city}>
                      <Link
                        href={`/rent/${slugifyCity(city)}`}
                        className="block rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary-dark hover:bg-primary/20"
                      >
                        {city}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {zips.length > 0 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">
                  ZIP codes we serve
                </h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {zips.map((zip) => (
                    <li
                      key={zip}
                      className="rounded-full bg-accent-soft px-4 py-1.5 text-sm font-medium text-accent-dark"
                    >
                      {zip}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <p className="text-ink-soft">
            The service area list is being finalized. Send us your address on
            the quote form and we&apos;ll confirm whether we can deliver to
            you.
          </p>
        )}

        <div className="mt-16 text-center">
          <ButtonLink href="/contact" variant="primary">
            Check your address
          </ButtonLink>
        </div>
      </Container>
    </>
  );
}
