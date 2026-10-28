import { SelectBridge } from "@/components/site/select-bridge";
import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { PageHero } from "@/components/site/page-hero";
import { SiteCta } from "@/components/site/site-cta";
import { AddressCheck } from "@/components/site/address-check";
import { addressCheckCopy } from "@/components/site/address-check-copy";
import { ServiceAreaMap } from "@/components/site/service-area-map";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedContent } from "@/domains/site-content";
import { getSiteForRequest } from "@/domains/site-content/request";
import { siteCopy, siteFacts, siteLinkValue } from "@/domains/site-content/facts";
import { readZoneSettings, zonePriceWords } from "@/domains/delivery/zone";
import { townsWithZones } from "@/domains/delivery/towns";
import { ZONE_COLOR_CLASSES, zoneRangeWords } from "@/domains/delivery/map";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.service-area.title"], description: content["seo.service-area.description"] };
}

const milesWords = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/**
 * ZONE-1: the delivery-zone map (our own drawing), the legend with each zone's price (prices only once the owner
 * switches them on; the free zone always says so), the address checker and the towns grouped by zone. Works without
 * JavaScript except the checker's in-place answer (it still answers as a plain form).
 */
export default async function ServiceAreaPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const [settings, site] = await Promise.all([getBusinessSettings(), searchParams.then(getSiteForRequest)]);
  const zones = readZoneSettings(settings);
  const facts = siteFacts(settings);
  const c = siteCopy(site.text, facts);
  const towns = townsWithZones(zones);
  const lastOuter = zones.zones[zones.zones.length - 1]!.outerMiles;
  const reach = milesWords(Math.min(zones.maxMiles, lastOuter));
  const outsideTowns = towns.filter((town) => town.zone.kind === "OUTSIDE");
  // Driving-distance zones: the straight-line circles are only an illustration, so no price or free-delivery promise.
  const driving = zones.method === "DRIVING";

  return (
    <>
      <SelectBridge site={site} />
      <PageHero heading={c("area.heading")} lede={c("area.intro", { miles: reach })} />

      <Container className="py-12 md:py-16">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:items-start">
          <ServiceAreaMap settings={zones} towns={towns}
            copy={{ title: c("area.map.title"), north: c("area.map.north"), scale: c("area.map.scale", { miles: "10" }),
              center: c("area.map.center") }} />
          <div className="space-y-10">
            <section aria-labelledby="zone-legend">
              <h2 id="zone-legend" className="text-h2 text-ink">{c("area.legend.heading")}</h2>
              <ul className="mt-5 space-y-3">
                {zones.zones.map((zone, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-card border border-hairline bg-surface p-4">
                    <span aria-hidden="true" className={`mt-1 inline-block h-5 w-5 shrink-0 rounded-full border-2 ${ZONE_COLOR_CLASSES[zone.color].swatch}`} />
                    <span className="min-w-0">
                      <span className="block font-semibold text-ink">{zone.name}</span>
                      <span className="block text-sm text-ink-soft">{c("area.zone.miles", { miles: zoneRangeWords(zones.zones, index) })}</span>
                      <span className="block text-sm font-semibold text-ink">
                        {driving ? c("area.zone.driving")
                          : zone.deliveryCents === 0 ? c("area.zone.free")
                          : zones.showPricesOnWebsite ? c("area.zone.price", { price: zonePriceWords(zone.deliveryCents) })
                            : c("area.zone.hidden")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-4 font-semibold text-ink">{c("area.zone.outside", { miles: reach })}</p>
              <p className="mt-2 text-sm text-ink-soft">{c("area.zone.pickup")}</p>
            </section>
            <section aria-labelledby="zone-check">
              <h2 id="zone-check" className="text-h2 text-ink">{c("area.check.heading")}</h2>
              <div className="mt-5">
                <AddressCheck id="area-check" quoteHref="/contact" copy={{ ...addressCheckCopy(c), button: c("area.check.button") }} />
              </div>
            </section>
          </div>
        </div>

        <section aria-labelledby="zone-towns" className="mt-16">
          <h2 id="zone-towns" className="text-h2 text-ink">{c("area.towns.heading")}</h2>
          <p className="mt-2 max-w-2xl text-ink-soft">{c("area.towns.note")}</p>
          {driving && <p className="mt-2 max-w-2xl font-semibold text-ink">{c("area.zone.driving")}</p>}
          <div className="mt-6 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            {zones.zones.map((zone, index) => {
              const inZone = towns.filter((town) => town.zone.kind === "ZONE" && town.zone.zone === index + 1);
              if (!inZone.length) return null;
              return (
                <div key={index}>
                  <h3 className="font-display text-lg font-semibold text-ink">{zone.name}</h3>
                  <ul className="mt-3 space-y-1">
                    {inZone.map((town) => (
                      <li key={town.slug}>
                        <Link href={`/rent/${town.slug}`} className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:text-primary hover:underline">
                          {town.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {outsideTowns.length > 0 && (
              <div>
                <h3 className="font-display text-lg font-semibold text-ink">{c("area.towns.outside")}</h3>
                <ul className="mt-3 space-y-1">
                  {outsideTowns.map((town) => (
                    <li key={town.slug}>
                      <Link href={`/rent/${town.slug}`} className="inline-flex min-h-11 items-center text-ink underline-offset-4 hover:text-primary hover:underline">
                        {town.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>

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
