import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/site/container";
import { ButtonLink } from "@/components/site/button-link";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings, parseServiceArea } from "@/domains/settings";
import { getPublishedApplianceTypes, formatCents } from "@/domains/pricing";
import { getLaunchSettings } from "@/domains/launch";

export default async function HomePage() {
  const [settings, applianceTypes, launch] = await Promise.all([
    getBusinessSettings(),
    getPublishedApplianceTypes(),
    getLaunchSettings(),
  ]);
  const serviceArea = parseServiceArea(settings);

  if (launch.prelaunchMode)
    return (
      <>
        <section>
          <Container className="grid items-center gap-12 py-16 md:grid-cols-2 md:py-24">
            <div>
              <p className="inline-flex rounded-full bg-primary-soft px-4 py-2 text-sm font-semibold text-primary-dark">
                Preparing to launch · Greeley, Colorado
              </p>
              <h1 className="mt-6 font-display text-4xl font-semibold leading-tight md:text-5xl">
                Make room for everyday.
              </h1>
              <p className="mt-5 text-lg text-ink-soft">
                Family-owned washer and dryer rentals for Greeley and the
                surrounding area. A local option for households and property
                managers, with maintenance always included.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <ButtonLink href="/launch" variant="primary">
                  Join the launch interest list
                </ButtonLink>
                <ButtonLink href="/contact" variant="outline">
                  Ask a question
                </ButtonLink>
              </div>
              <p className="mt-4 text-sm text-ink-soft">
                No payment or rental commitment. Our opening date is still being
                finalized.
              </p>
            </div>
            <div className="rounded-3xl border border-line bg-surface p-8 md:p-10">
              <h2 className="font-display text-2xl font-semibold">
                A local business, built around a local need.
              </h2>
              <p className="mt-4 text-ink-soft">
                We started Robinson Appliance Rentals because we believe our
                community needs more choices beyond buying appliances outright
                or taking on expensive rent-to-own arrangements.
              </p>
              <p className="mt-4 text-ink-soft">
                We&apos;re a small family business getting ready to serve our
                neighbors. Join our interest list to hear how things are coming
                together.
              </p>
            </div>
          </Container>
        </section>
        <section className="border-y border-line bg-surface">
          <Container className="grid gap-8 py-12 md:grid-cols-3">
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
              <div key={title}>
                <h2 className="font-display text-xl font-semibold">{title}</h2>
                <p className="mt-3 text-ink-soft">{body}</p>
              </div>
            ))}
          </Container>
        </section>
        <section>
          <Container className="py-16 text-center">
            <h2 className="font-display text-3xl font-semibold">
              Help us get ready for your neighborhood.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-ink-soft">
              Tell us your city and which appliances interest you. We&apos;ll
              send launch news and a short introduction to our business.
            </p>
            <div className="mt-6">
              <ButtonLink href="/launch" variant="primary">
                Keep me updated
              </ButtonLink>
            </div>
          </Container>
        </section>
      </>
    );

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
              A clean washer &amp; dryer, delivered — without the down payment.
            </h1>
            <p className="mt-5 max-w-lg text-lg text-ink-soft">
              {settings.publicBusinessName} rents washers and dryers to Colorado
              homes, renters, and property managers on simple month-to-month
              terms. No big upfront cost, no surprise fees, and real people to
              call when something needs attention.
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
            <div className="w-full max-w-md overflow-hidden rounded-3xl bg-surface p-2 shadow-xl shadow-ink/5 ring-1 ring-line sm:p-3">
              <Image
                src="/appliances/hero-lineup.jpg"
                alt="A washer, dryer, range, and refrigerator — the kinds of appliances we rent"
                width={1408}
                height={768}
                className="h-auto w-full rounded-2xl object-cover"
                priority
              />
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
              Four steps, and Chris personally reviews every request — this is a
              real local business, not a call center.
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
                Starting with washers and dryers, with more appliance types on
                the way. Every price below is real, and never changes for you
                once you sign — see our{" "}
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
            Tell us what you need and where — we&apos;ll follow up with a quote,
            usually the same day.
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
