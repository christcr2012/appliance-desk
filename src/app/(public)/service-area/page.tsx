import { SelectBridge } from "@/components/site/select-bridge";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { PageHero } from "@/components/site/page-hero";
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
      <PageHero heading={c("area.heading")} lede={c("area.intro")} />

      <Container className="py-16 md:py-20">
        {cities.length > 0 || zips.length > 0 ? (
          <div className="grid gap-10 md:grid-cols-2">
            {cities.length > 0 && (
              <div>
                <h2 className="text-h2 text-ink">{c("area.cities.heading")}</h2>
                <ul className="mt-6 divide-y divide-hairline border-y border-hairline">
                  {cities.map((city) => (
                    <li key={city}>
                      <Link
                        href={`/rent/${slugifyCity(city)}`}
                        className="flex min-h-14 items-center justify-between gap-4 py-3 text-h3 text-ink hover:text-primary"
                      >
                        {city}
                        <span aria-hidden="true" className="text-primary after:content-['→']" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {zips.length > 0 && (
              <div>
                <h2 className="text-h2 text-ink">{c("area.zips.heading")}</h2>
                <ul className="mt-6 flex flex-wrap gap-2">
                  {zips.map((zip) => (
                    <li
                      key={zip}
                      className="rounded-full border border-hairline bg-surface px-4 py-2 text-sm font-semibold tabular-nums text-ink"
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
