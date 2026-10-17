import { SelectBridge } from "@/components/site/select-bridge";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { SiteCta } from "@/components/site/site-cta";
import { RichText } from "@/components/site/rich-text";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue } from "@/domains/site-content/facts";

function slugifyCity(city: string): string {
  return city.trim().toLowerCase().replace(/\s+/g, "-");
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.service-area.title"], description: content["seo.service-area.description"] };
}

export default async function ServiceAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const [settings, site] = await Promise.all([getBusinessSettings(), searchParams.then(getSiteForRequest)]);
  const facts = siteFacts(settings);
  const c = siteCopy(site.text, facts);
  const { cities, zips } = parseServiceArea(settings);

  return (
    <>
      <SelectBridge site={site} />
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            {c("area.heading")}
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            {c("area.intro")}
          </p>
        </Container>
      </section>

      <Container className="py-16 md:py-20">
        {cities.length > 0 || zips.length > 0 ? (
          <div className="grid gap-10 md:grid-cols-2">
            {cities.length > 0 && (
              <div>
                <h2 className="font-display text-xl font-semibold text-ink">
                  {c("area.cities.heading")}
                </h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {cities.map((city) => (
                    <li key={city}>
                      <Link
                        href={`/rent/${slugifyCity(city)}`}
                        className="block rounded-control bg-primary-soft px-4 py-2 text-sm font-semibold text-primary-dark hover:bg-subtle"
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
                  {c("area.zips.heading")}
                </h2>
                <ul className="mt-4 flex flex-wrap gap-2">
                  {zips.map((zip) => (
                    <li
                      key={zip}
                      className="rounded-control bg-accent-soft px-4 py-2 text-sm font-semibold text-accent-dark"
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
            <RichText text={c("area.empty")} />
          </p>
        )}

        <div className="mt-16 text-center">
          <SiteCta
            value={siteLinkValue(site.values, "area.cta")}
            profile={{ phone: settings.publicPhone, email: settings.publicEmail }}
            facts={facts}
          />
        </div>
      </Container>
    </>
  );
}
