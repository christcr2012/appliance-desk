import { Container } from "@/components/site/container";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { Card } from "@/components/ui";
import { SiteCta } from "@/components/site/site-cta";
import { RichText } from "@/components/site/rich-text";
import { HeroPicture } from "@/components/site/hero-picture";
import { FeaturedPromotion } from "@/components/site/featured-promotion";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedCatalog, formatCents } from "@/domains/pricing";
import { getLaunchSettings } from "@/domains/launch";
import { getSiteForRequest } from "@/domains/site-content/request";
import { catalogAlt, fillSiteText } from "@/domains/site-content/fields";
import { siteCopy, siteFacts, siteLinkValue } from "@/domains/site-content/facts";

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

  if (showPrelaunchHome) {
    return (
      <>
        <section className="bg-canvas">
          <Container className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
            <div>
              <p className="inline-flex rounded-control bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-dark">
                {c("home.prelaunch.eyebrow")}
              </p>
              <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-primary dark:text-ink md:text-5xl">
                {c("home.prelaunch.heading")}
              </h1>
              <p className="mt-5 max-w-xl text-lg text-ink-soft">
                {c("home.prelaunch.body")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                {cta("home.prelaunch.cta.primary", "primary", "lg")}
                {textCta("home.prelaunch.cta.secondary")}
              </div>
              <p className="mt-4 text-sm text-ink-soft">
                {c("home.prelaunch.note")}
              </p>
            </div>
            <div className="overflow-hidden rounded-card border border-line bg-surface p-2">
              <HeroPicture value={site.values["home.hero.image"]} defaultAlt={c("image.hero.alt")} preview={site.preview} />
            </div>
          </Container>
        </section>

        <section className="border-y border-line bg-surface">
          <Container className="grid gap-5 py-12 md:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <Card key={n} title={c(`home.prelaunch.benefit.${n}.title`)}>
                <p className="text-sm text-ink-soft">{c(`home.prelaunch.benefit.${n}.body`)}</p>
              </Card>
            ))}
          </Container>
        </section>

        <section>
          <Container className="py-16 text-center">
            <h2 className="font-display text-3xl font-semibold text-ink">
              {c("home.prelaunch.cta.heading")}
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-ink-soft">
              {c("home.prelaunch.cta.body")}
            </p>
            <div className="mt-6">
              {cta("home.prelaunch.cta.button")}
            </div>
          </Container>
        </section>
      </>
    );
  }

  return (
    <>
      <section className="bg-canvas">
        <Container className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
          <div>
            <p className="inline-flex rounded-control bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-dark">
              {c("home.hero.eyebrow")}
            </p>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-primary dark:text-ink md:text-5xl">
              {c("home.hero.heading")}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-soft">
              {c("home.hero.body")}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {cta("home.hero.cta.primary", "primary", "lg")}
              {textCta("home.hero.cta.secondary")}
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface p-2">
            <HeroPicture value={site.values["home.hero.image"]} defaultAlt={c("image.hero.alt")} preview={site.preview} />
          </div>
        </Container>
      </section>

      <FeaturedPromotion value={site.values["home.feature.promotion"]} now={site.now} preview={site.preview} profile={profile} facts={facts} />

      <section className="border-y border-line bg-surface">
        <Container className="grid gap-5 py-12 sm:grid-cols-3">
          {[1, 2, 3].map((n) => (
            <Card key={n} title={c(`home.benefit.${n}.title`)}>
              <p className="text-sm text-ink-soft">{c(`home.benefit.${n}.body`)}</p>
            </Card>
          ))}
        </Container>
      </section>

      <section>
        <Container className="py-16 md:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-ink">
              {c("home.how.heading")}
            </h2>
            <p className="mt-3 text-ink-soft">
              {c("home.how.intro")}
            </p>
          </div>
          <ol className="mt-10 grid gap-5 md:grid-cols-4">
            {[1, 2, 3, 4].map((n) => c(`home.how.step.${n}`)).map((step, i) => (
              <li key={step}>
                <Card>
                  <span className="font-display text-2xl font-semibold text-primary">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="mt-3 font-semibold text-ink">{step}</p>
                </Card>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {(content["home.household"] || content["home.propertyManager"]) && (
        <section>
          <Container className="grid gap-5 py-12 md:grid-cols-2">
            {content["home.household"] && (
              <Card title={c("home.household.title")}>
                <p className="text-ink-soft">
                  {c("home.household")}
                </p>
              </Card>
            )}
            {content["home.propertyManager"] && (
              <Card title={c("home.propertyManager.title")}>
                <p className="text-ink-soft">
                  {c("home.propertyManager")}
                </p>
              </Card>
            )}
          </Container>
        </section>
      )}

      <section className="border-y border-line bg-canvas-alt">
        <Container className="py-16 md:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-ink">
              {c("home.pricing.heading")}
            </h2>
            <p className="mt-3 text-ink-soft">
              <RichText text={c("home.pricing.intro")} />
            </p>
          </div>

          {applianceTypes.length > 0 ? (
            <>
              <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {applianceTypes.map((type) => (
                  <Card key={`${type.kind}-${type.id}`}>
                    <ApplianceMedia
                      photoUrl={type.photoUrl}
                      name={type.name}
                      alt={catalogAlt(content, type.slug, type.name)}
                      className="h-40 w-full rounded-control object-cover"
                      iconClassName="h-16 w-auto text-primary"
                    />
                    <h3 className="mt-4 font-display text-xl font-semibold text-ink">
                      {type.name}
                    </h3>
                    <p className="mt-1 text-2xl font-semibold text-ink">
                      {formatCents(type.monthlyPriceCents)}
                      <span className="text-sm font-normal text-ink-faint">
                        {" "}
                        {c("price.perMonth")}
                      </span>
                    </p>
                    {type.savingCents ? (
                      <p className="mt-1 text-sm font-medium text-accent-dark">
                        {c("price.saving", { contents: type.contents ?? "", amount: formatCents(type.savingCents) })}
                      </p>
                    ) : null}
                  </Card>
                ))}
              </div>
              <p className="mt-6 text-sm text-ink-faint">
                {c("price.illustrationNote")}
              </p>
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
          <Container className="max-w-3xl py-16 md:py-20">
            <h2 className="font-display text-3xl font-semibold text-ink">
              {c("home.faq.heading")}
            </h2>
            <dl className="mt-8 space-y-5">
              {faq.map((item, i) => (
                <Card key={i}>
                  <dt className="font-semibold text-ink">
                    {fillSiteText(item.q, facts)}
                  </dt>
                  <dd className="mt-2 text-ink-soft">
                    {fillSiteText(item.a, facts)}
                  </dd>
                </Card>
              ))}
            </dl>
          </Container>
        </section>
      )}

      <section>
        <Container className="py-16 text-center md:py-20">
          <h2 className="font-display text-3xl font-semibold text-ink">
            {c("home.cta.heading")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-soft">
            {c("home.cta.body")}
          </p>
          <div className="mt-8">
            {cta("home.cta.button")}
          </div>
        </Container>
      </section>
    </>
  );
}
