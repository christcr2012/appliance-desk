import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/site/container";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { ButtonLink, Card } from "@/components/ui";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedApplianceTypes, formatCents } from "@/domains/pricing";
import { getLaunchSettings } from "@/domains/launch";
import { getContentForRequest } from "@/domains/site-content/request";
import { catalogAlt, fillSiteText } from "@/domains/site-content/fields";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const [settings, applianceTypes, launch, content] = await Promise.all([
    getBusinessSettings(),
    getPublishedApplianceTypes(),
    getLaunchSettings(),
    searchParams.then(getContentForRequest),
  ]);
  const businessName = settings.publicBusinessName;
  const faq = Array.from({ length: 8 }, (_, i) => ({
    q: content[`faq.${i + 1}.q`] ?? "",
    a: content[`faq.${i + 1}.a`] ?? "",
  })).filter((item) => item.q && item.a);
  const serviceArea = parseServiceArea(settings);

  if (launch.prelaunchMode) {
    return (
      <>
        <section className="bg-canvas">
          <Container className="grid items-center gap-10 py-14 md:grid-cols-2 md:py-20">
            <div>
              <p className="inline-flex rounded-control bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-dark">
                Preparing to launch · Greeley, Colorado
              </p>
              <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-primary dark:text-ink md:text-5xl">
                {fillSiteText(content["home.prelaunch.heading"], { businessName })}
              </h1>
              <p className="mt-5 max-w-xl text-lg text-ink-soft">
                {fillSiteText(content["home.prelaunch.body"], { businessName })}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-4">
                <ButtonLink href="/launch" size="lg">
                  Join the launch interest list
                </ButtonLink>
                <Link
                  href="/contact"
                  className="inline-flex min-h-11 items-center font-semibold text-primary underline"
                >
                  Ask a question
                </Link>
              </div>
              <p className="mt-4 text-sm text-ink-soft">
                No payment or rental commitment. Our opening date is still being
                finalized.
              </p>
            </div>
            <div className="overflow-hidden rounded-card border border-line bg-surface p-2">
              <Image
                src="/appliances/hero-lineup.jpg"
                alt={fillSiteText(content["image.hero.alt"], { businessName })}
                width={1408}
                height={768}
                className="h-auto w-full rounded-control object-cover"
                priority
              />
            </div>
          </Container>
        </section>

        <section className="border-y border-line bg-surface">
          <Container className="grid gap-5 py-12 md:grid-cols-3">
            {[
              [
                "Maintenance included",
                "Maintenance is always part of your rental.",
              ],
              [
                "Delivery & installation",
                "Available based on your location and setup. We confirm requirements and any fees before you commit.",
              ],
              [
                "Local households & properties",
                "Planning for renters, homeowners, landlords, and property managers in Greeley and the surrounding area.",
              ],
            ].map(([title, body]) => (
              <Card key={title} title={title}>
                <p className="text-sm text-ink-soft">{body}</p>
              </Card>
            ))}
          </Container>
        </section>

        <section>
          <Container className="py-16 text-center">
            <h2 className="font-display text-3xl font-semibold text-ink">
              Help us get ready for your neighborhood.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-ink-soft">
              Tell us your city and which appliances interest you. We&apos;ll
              send launch news and a short introduction to our business.
            </p>
            <div className="mt-6">
              <ButtonLink href="/launch">Keep me updated</ButtonLink>
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
              Now renting in {serviceArea.cities[0] ?? "Colorado"}
            </p>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-primary dark:text-ink md:text-5xl">
              {fillSiteText(content["home.hero.heading"], { businessName })}
            </h1>
            <p className="mt-5 max-w-xl text-lg text-ink-soft">
              {fillSiteText(content["home.hero.body"], { businessName })}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <ButtonLink href="/contact" size="lg">
                Check your address
              </ButtonLink>
              <Link
                href="/pricing"
                className="inline-flex min-h-11 items-center font-semibold text-primary underline"
              >
                See prices
              </Link>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-line bg-surface p-2">
            <Image
              src="/appliances/hero-lineup.jpg"
              alt={fillSiteText(content["image.hero.alt"], { businessName })}
              width={1408}
              height={768}
              className="h-auto w-full rounded-control object-cover"
              priority
            />
          </div>
        </Container>
      </section>

      <section className="border-y border-line bg-surface">
        <Container className="grid gap-5 py-12 sm:grid-cols-3">
          {[
            {
              title: "No long-term contract",
              body: "Month-to-month, 6-month, or 12-month terms — you choose, and you can change your mind later.",
            },
            {
              title: "Delivered & installed",
              body: "We bring it, hook it up, and haul away your old unit if you need that too.",
            },
            {
              title: "We fix it, fast",
              body: "Something breaks, you call us — not a warranty hotline in another state.",
            },
          ].map((item) => (
            <Card key={item.title} title={item.title}>
              <p className="text-sm text-ink-soft">{item.body}</p>
            </Card>
          ))}
        </Container>
      </section>

      <section>
        <Container className="py-16 md:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-ink">
              How renting works
            </h2>
            <p className="mt-3 text-ink-soft">
              Four steps, and Chris personally reviews every request — this is a
              real local business, not a call center.
            </p>
          </div>
          <ol className="mt-10 grid gap-5 md:grid-cols-4">
            {[
              "Tell us what you need",
              "We follow up to confirm details",
              "Sign your rental agreement",
              "We deliver & install",
            ].map((step, i) => (
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
              <Card title="For households">
                <p className="text-ink-soft">
                  {fillSiteText(content["home.household"], { businessName })}
                </p>
              </Card>
            )}
            {content["home.propertyManager"] && (
              <Card title="For property managers">
                <p className="text-ink-soft">
                  {fillSiteText(content["home.propertyManager"], { businessName })}
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
              Simple, published pricing
            </h2>
            <p className="mt-3 text-ink-soft">
              Starting with washers and dryers, with more appliance types on
              the way. Every price below is real, and never changes for you
              once you sign — see our{" "}
              <Link href="/pricing" className="underline hover:text-primary">
                full pricing page
              </Link>
              .
            </p>
          </div>

          {applianceTypes.length > 0 ? (
            <>
              <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {applianceTypes.map((type) => (
                  <Card key={type.id}>
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
                        / month
                      </span>
                    </p>
                  </Card>
                ))}
              </div>
              <p className="mt-6 text-sm text-ink-faint">
                Illustrations are generic and for reference only — the actual
                appliance you receive may vary in brand, model, and color.
              </p>
            </>
          ) : (
            <p className="mt-10 text-ink-soft">
              Pricing is being finalized — reach out and we&apos;ll quote you
              directly.
            </p>
          )}
        </Container>
      </section>

      {faq.length > 0 && (
        <section>
          <Container className="max-w-3xl py-16 md:py-20">
            <h2 className="font-display text-3xl font-semibold text-ink">
              Common questions
            </h2>
            <dl className="mt-8 space-y-5">
              {faq.map((item, i) => (
                <Card key={i}>
                  <dt className="font-semibold text-ink">
                    {fillSiteText(item.q, { businessName })}
                  </dt>
                  <dd className="mt-2 text-ink-soft">
                    {fillSiteText(item.a, { businessName })}
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
            Ready to get set up?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-soft">
            Tell us what you need and where — we&apos;ll follow up with a quote,
            usually the same day.
          </p>
          <div className="mt-8">
            <ButtonLink href="/contact">Check your address</ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
