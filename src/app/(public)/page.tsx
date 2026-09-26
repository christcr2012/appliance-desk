import Link from "next/link";
import { Container } from "@/components/site/container";
import { ButtonLink } from "@/components/site/button-link";
import { ApplianceIcon, ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedApplianceTypes, formatCents } from "@/domains/pricing";

export default async function HomePage() {
  const [settings, applianceTypes] = await Promise.all([
    getBusinessSettings(),
    getPublishedApplianceTypes(),
  ]);
  const serviceArea = parseServiceArea(settings);
  const heroTypes = applianceTypes
    .filter((t) => t.slug === "washer" || t.slug === "dryer")
    .slice(0, 2);

  return (
    <>
      {/* Hero */}
      <section className="overflow-hidden">
        <Container className="grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
          <div>
            <p className="inline-flex items-center rounded-full bg-primary-soft px-4 py-1.5 text-sm font-medium text-primary-dark">
              Now renting in {serviceArea.cities[0] ?? "Colorado"}
            </p>
            <h1 className="mt-6 font-display text-4xl font-semibold leading-tight text-ink md:text-5xl">
              A clean washer &amp; dryer, delivered — without the down
              payment.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink-soft">
              {settings.publicBusinessName} rents washers and dryers to
              Colorado homes, renters, and property managers on simple
              month-to-month terms. No big upfront cost, no surprise fees,
              and real people to call when something needs attention.
            </p>
            <div className="mt-8 flex flex-wrap gap-4">
              <ButtonLink href="/contact" variant="primary">
                Get a free quote
              </ButtonLink>
              <ButtonLink href="/pricing" variant="outline">
                See pricing
              </ButtonLink>
            </div>
          </div>

          <div className="relative flex justify-center">
            <div className="flex w-full max-w-full items-center justify-center gap-3 rounded-3xl bg-surface p-4 shadow-xl shadow-ink/5 ring-1 ring-line sm:gap-6 sm:p-10">
              {heroTypes.length > 0 ? (
                heroTypes.map((type) => (
                  <ApplianceMedia
                    key={type.id}
                    photoUrl={type.photoUrl}
                    name={type.name}
                    className="h-28 w-1/2 max-w-[14rem] rounded-xl object-cover sm:h-40 sm:w-56"
                    iconClassName="h-28 w-auto text-primary sm:h-40"
                  />
                ))
              ) : (
                <>
                  <ApplianceIcon className="h-28 w-auto text-primary sm:h-40" />
                  <ApplianceIcon className="h-28 w-auto text-accent sm:h-40" />
                </>
              )}
            </div>
          </div>
        </Container>
      </section>

      {/* Trust bullets */}
      <section className="border-y border-line bg-surface">
        <Container className="grid gap-8 py-12 sm:grid-cols-3">
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
            <div key={item.title}>
              <h2 className="font-display text-lg font-semibold text-ink">
                {item.title}
              </h2>
              <p className="mt-2 text-sm text-ink-soft">{item.body}</p>
            </div>
          ))}
        </Container>
      </section>

      {/* How it works */}
      <section>
        <Container className="py-16 md:py-20">
          <div className="max-w-2xl">
            <h2 className="font-display text-3xl font-semibold text-ink">
              How renting works
            </h2>
            <p className="mt-3 text-ink-soft">
              Four steps, and Chris personally reviews every request — this
              is a real local business, not a call center.
            </p>
          </div>
          <ol className="mt-10 grid gap-8 md:grid-cols-4">
            {[
              "Tell us what you need",
              "We follow up to confirm details",
              "Sign your rental agreement",
              "We deliver & install",
            ].map((step, i) => (
              <li key={step}>
                <span className="font-display text-3xl font-semibold text-primary">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="mt-3 font-medium text-ink">{step}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      {/* Pricing preview */}
      <section className="border-y border-line bg-canvas-alt">
        <Container className="py-16 md:py-20">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="font-display text-3xl font-semibold text-ink">
                Simple, published pricing
              </h2>
              <p className="mt-3 max-w-xl text-ink-soft">
                Starting with washers and dryers, with more appliance types
                on the way. Every price below is real, and never changes for
                you once you sign — see our{" "}
                <Link href="/pricing" className="underline hover:text-primary">
                  full pricing page
                </Link>
                .
              </p>
            </div>
          </div>

          {applianceTypes.length > 0 ? (
            <>
              <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                {applianceTypes.map((type) => (
                  <div
                    key={type.id}
                    className="rounded-2xl bg-surface p-6 shadow-sm ring-1 ring-line"
                  >
                    <ApplianceMedia
                      photoUrl={type.photoUrl}
                      name={type.name}
                      className="h-40 w-full rounded-lg object-cover"
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
                  </div>
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

      {/* Final CTA */}
      <section>
        <Container className="py-16 text-center md:py-20">
          <h2 className="font-display text-3xl font-semibold text-ink">
            Ready to get set up?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-ink-soft">
            Tell us what you need and where — we&apos;ll follow up with a
            quote, usually the same day.
          </p>
          <div className="mt-8">
            <ButtonLink href="/contact" variant="primary">
              Get a free quote
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}
