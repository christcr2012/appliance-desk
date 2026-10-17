import { SelectBridge } from "@/components/site/select-bridge";
import { Container } from "@/components/site/container";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { SiteCta } from "@/components/site/site-cta";
import { AddressCheck } from "@/components/site/address-check";
import { RichText } from "@/components/site/rich-text";
import { HeroPicture } from "@/components/site/hero-picture";
import { FeaturedPromotion } from "@/components/site/featured-promotion";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedCatalog, formatCents } from "@/domains/pricing";
import { getLaunchSettings } from "@/domains/launch";
import { getSiteForRequest } from "@/domains/site-content/request";
import { catalogAlt, fillSiteText } from "@/domains/site-content/fields";
import { siteCopy, siteFacts, siteLinkValue } from "@/domains/site-content/facts";
import { resolveLinkHref } from "@/domains/site-content/links";
import { splitHighlight } from "@/domains/site-content/highlight";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{
    revision?: string | string[];
    home?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const [settings, applianceTypes, launch, site] = await Promise.all([
    getBusinessSettings(),
    getPublishedCatalog(),
    getLaunchSettings(),
    getSiteForRequest(params),
  ]);
  const content = site.text;
  const serviceArea = parseServiceArea(settings);
  const city = serviceArea.cities[0] ?? "Colorado";
  const facts = siteFacts(settings, { city });
  const c = siteCopy(content, facts);
  const profile = { phone: settings.publicPhone, email: settings.publicEmail };
  const cta = (key: string, variant?: "primary" | "secondary", size?: "lg") => (
    <SiteCta value={siteLinkValue(site.values, key)} profile={profile} facts={facts} variant={variant} size={size} />
  );
  const textCta = (key: string) => (
    <SiteCta value={siteLinkValue(site.values, key)} profile={profile} facts={facts} textStyle />
  );
  const faq = Array.from({ length: 8 }, (_, i) => ({
    q: content[`faq.${i + 1}.q`] ?? "",
    a: content[`faq.${i + 1}.a`] ?? "",
  })).filter((item) => item.q && item.a);
  const showPrelaunchHome = launch.prelaunchMode;

  // The address check answers from the owner's ZIP list, so it only appears when the owner has listed ZIP codes.
  const quoteLink = siteLinkValue(site.values, "home.hero.cta.primary");
  const quoteResolved = quoteLink ? resolveLinkHref(quoteLink.target, profile) : null;
  const quoteHref = quoteResolved?.startsWith("/") ? quoteResolved : "/contact";
  const showCheck = serviceArea.zips.length > 0 && quoteLink !== undefined;
  const split = splitHighlight(c("home.hero.heading"), c("home.hero.highlight"));
  const heading = split ? (
    <>
      {split.before}
      <span className="highlight">{split.match}</span>
      {split.after}
    </>
  ) : (
    c("home.hero.heading")
  );
  const featured = applianceTypes.find((item) => item.kind === "package") ?? null;

  const eyebrow = (text: string) => (
    <p className="inline-flex rounded-full bg-primary-soft px-4 py-2 text-eyebrow uppercase text-primary-dark">{text}</p>
  );
  const photo = (ticket: React.ReactNode) => (
    <div className="signature-rise relative pb-10 pl-4 pr-4 sm:pr-0">
      <div aria-hidden="true" className="cut-corner-photo absolute inset-y-6 right-0 left-12 bg-tint" />
      <div className="cut-corner-photo relative overflow-hidden bg-surface">
        <HeroPicture value={site.values["home.hero.image"]} defaultAlt={c("image.hero.alt")} preview={site.preview} selectable={site.selectable} />
      </div>
      {ticket}
    </div>
  );
  const ledger = (items: { title: string; body: string }[]) => (
    <section className="border-y border-hairline bg-surface">
      <Container className="py-14 md:py-16">
        <ul className="grid gap-x-12 gap-y-8 md:grid-cols-3">
          {items.map((item) => (
            <li key={item.title} className="border-t-2 border-primary pt-5">
              <h2 className="text-h3 text-ink">{item.title}</h2>
              <p className="mt-2 text-ink-soft">{item.body}</p>
            </li>
          ))}
        </ul>
      </Container>
    </section>
  );

  if (showPrelaunchHome) {
    return (
      <>
        <SelectBridge site={site} />
        <section className="bg-canvas">
          <Container className="grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              {eyebrow(c("home.prelaunch.eyebrow"))}
              <h1 className="signature-rise mt-6 font-display text-display text-primary dark:text-ink">{c("home.prelaunch.heading")}</h1>
              <p className="mt-6 max-w-xl text-lede text-ink-soft">{c("home.prelaunch.body")}</p>
              <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
                {cta("home.prelaunch.cta.primary", "primary", "lg")}
                {textCta("home.prelaunch.cta.secondary")}
              </div>
              <p className="mt-4 text-sm text-ink-soft">{c("home.prelaunch.note")}</p>
            </div>
            {photo(null)}
          </Container>
        </section>

        {ledger([1, 2, 3].map((n) => ({ title: c(`home.prelaunch.benefit.${n}.title`), body: c(`home.prelaunch.benefit.${n}.body`) })))}

        <section>
          <Container className="py-16 text-center md:py-20">
            <h2 className="text-h2 text-ink">{c("home.prelaunch.cta.heading")}</h2>
            <p className="mx-auto mt-4 max-w-xl text-lede text-ink-soft">{c("home.prelaunch.cta.body")}</p>
            <div className="mt-8">{cta("home.prelaunch.cta.button")}</div>
          </Container>
        </section>
      </>
    );
  }

  return (
    <>
      <SelectBridge site={site} />
      <section className="bg-canvas">
        <Container className="grid items-center gap-12 py-14 md:py-20 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            {eyebrow(c("home.hero.eyebrow"))}
            <h1 className="signature-rise mt-6 font-display text-display text-primary dark:text-ink">{heading}</h1>
            <p className="mt-6 max-w-xl text-lede text-ink-soft">{c("home.hero.body")}</p>
            <div className="mt-8">
              {showCheck ? (
                <AddressCheck
                  quoteHref={quoteHref}
                  launchHref="/launch"
                  copy={{
                    addressLabel: c("home.check.address.label"),
                    zipLabel: c("home.check.zip.label"),
                    button: quoteLink ? fillSiteText(quoteLink.label, facts) : "",
                    served: c("home.check.served"),
                    servedLink: c("home.check.served.cta"),
                    notYet: c("home.check.notyet"),
                    notYetLink: c("home.check.notyet.cta"),
                    invalid: c("home.check.invalid"),
                    limited: c("home.check.limited"),
                  }}
                />
              ) : (
                <div className="flex flex-wrap items-center gap-4">{cta("home.hero.cta.primary", "primary", "lg")}</div>
              )}
              <div className="mt-4">{textCta("home.hero.cta.secondary")}</div>
            </div>
          </div>
          {photo(
            featured ? (
              <div className="absolute bottom-0 left-0 rounded-card border border-hairline bg-surface px-5 py-4 shadow-raise">
                <p className="text-eyebrow uppercase text-ink-soft">{c("home.ticket.label")}</p>
                <p className="mt-1 text-sm font-semibold text-ink">{featured.name}</p>
                <p className="mt-1 text-price tabular-nums text-ink">
                  {formatCents(featured.monthlyPriceCents)}
                  <span className="text-sm font-normal tracking-normal text-ink-soft"> {c("price.perMonth")}</span>
                </p>
              </div>
            ) : null,
          )}
        </Container>
      </section>

      <FeaturedPromotion value={site.values["home.feature.promotion"]} now={site.now} preview={site.preview} profile={profile} facts={facts} />

      {ledger([1, 2, 3].map((n) => ({ title: c(`home.benefit.${n}.title`), body: c(`home.benefit.${n}.body`) })))}

      <section>
        <Container className="py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-h2 text-ink">{c("home.how.heading")}</h2>
            <p className="mt-4 text-lede text-ink-soft">{c("home.how.intro")}</p>
          </div>
          <ol className="relative mt-12 grid gap-10 [counter-reset:step] md:grid-cols-4 md:gap-6">
            <span aria-hidden="true" className="absolute left-6 right-6 top-6 hidden border-t-2 border-dashed border-line-strong md:block" />
            {[1, 2, 3, 4].map((n) => c(`home.how.step.${n}`)).map((step) => (
              <li key={step} className="relative">
                <span aria-hidden="true" className="relative flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display text-lg font-extrabold text-on-primary [counter-increment:step] before:content-[counter(step)]" />
                <p className="mt-4 text-h3 text-ink">{step}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {(content["home.household"] || content["home.propertyManager"]) && (
        <section className="bg-canvas">
          <Container className="py-6 md:py-10">
            <div className="cut-band bg-primary px-6 py-12 text-on-primary dark:bg-surface dark:text-ink md:px-14 md:py-16">
              <div className="grid gap-10 md:grid-cols-2">
                {content["home.household"] && (
                  <div>
                    <h2 className="text-h2">{c("home.household.title")}</h2>
                    <p className="mt-4 text-lede opacity-90">{c("home.household")}</p>
                  </div>
                )}
                {content["home.propertyManager"] && (
                  <div>
                    <h2 className="text-h2">{c("home.propertyManager.title")}</h2>
                    <p className="mt-4 text-lede opacity-90">{c("home.propertyManager")}</p>
                  </div>
                )}
              </div>
            </div>
          </Container>
        </section>
      )}

      <section className="border-y border-hairline bg-canvas-alt">
        <Container className="py-16 md:py-24">
          <div className="max-w-2xl">
            <h2 className="text-h2 text-ink">{c("home.pricing.heading")}</h2>
            <p className="mt-4 text-lede text-ink-soft">
              <RichText text={c("home.pricing.intro")} />
            </p>
          </div>

          {applianceTypes.length > 0 ? (
            <>
              <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {applianceTypes.map((type) => {
                  const isFeatured = featured !== null && type.kind === featured.kind && type.id === featured.id;
                  return (
                    <div
                      key={`${type.kind}-${type.id}`}
                      className={
                        isFeatured
                          ? "cut-corner-md bg-primary p-5 text-on-primary dark:border-2 dark:border-primary dark:bg-surface dark:text-ink"
                          : "rounded-card border border-hairline bg-surface p-5 text-ink"
                      }
                    >
                      <ApplianceMedia
                        photoUrl={type.photoUrl}
                        name={type.name}
                        alt={catalogAlt(content, type.slug, type.name)}
                        className="h-44 w-full rounded-control bg-surface object-cover"
                        iconClassName="h-16 w-auto text-primary"
                      />
                      <h3 className="mt-5 text-h3">{type.name}</h3>
                      <p className="mt-2 text-price tabular-nums">
                        {formatCents(type.monthlyPriceCents)}
                        <span className="text-sm font-normal tracking-normal opacity-80"> {c("price.perMonth")}</span>
                      </p>
                      {type.savingCents ? (
                        <p className="mt-2 text-sm font-semibold">
                          {c("price.saving", { contents: type.contents ?? "", amount: formatCents(type.savingCents) })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <p className="mt-8 text-sm text-ink-soft">{c("price.illustrationNote")}</p>
            </>
          ) : (
            <p className="mt-10 text-ink-soft">
              <RichText text={c("home.pricing.empty")} />
            </p>
          )}
        </Container>
      </section>

      {faq.length > 0 && (
        <section>
          <Container className="py-16 md:py-24">
            <h2 className="text-h2 text-ink">{c("home.faq.heading")}</h2>
            <div className="mt-10 grid gap-x-14 md:grid-cols-2">
              {faq.map((item, i) => (
                <details key={i} className="group border-t border-hairline py-1">
                  <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 py-3 text-h3 text-ink">
                    {fillSiteText(item.q, facts)}
                    <span aria-hidden="true" className="text-2xl font-normal after:content-['+'] group-open:rotate-45" />
                  </summary>
                  <p className="pb-4 text-ink-soft">{fillSiteText(item.a, facts)}</p>
                </details>
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="bg-canvas">
        <Container className="py-16 text-center md:py-24">
          <h2 className="text-h2 text-ink">{c("home.cta.heading")}</h2>
          <p className="mx-auto mt-4 max-w-xl text-lede text-ink-soft">{c("home.cta.body")}</p>
          <div className="mt-8">{cta("home.cta.button")}</div>
        </Container>
      </section>
    </>
  );
}
