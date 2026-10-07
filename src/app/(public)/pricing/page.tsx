import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { ButtonLink, Card } from "@/components/ui";
import { ApplianceMedia } from "@/components/site/appliance-icon";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedApplianceTypes, formatCents } from "@/domains/pricing";
import { getPublishedContent } from "@/domains/site-content";
import { getContentForRequest } from "@/domains/site-content/request";
import { catalogAlt } from "@/domains/site-content/fields";

export async function generateMetadata(): Promise<Metadata> {
  const content = await getPublishedContent();
  return { title: content["seo.pricing.title"], description: content["seo.pricing.description"] };
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ revision?: string | string[] }>;
}) {
  const [settings, applianceTypes, content] = await Promise.all([
    getBusinessSettings(),
    getPublishedApplianceTypes(),
    searchParams.then(getContentForRequest),
  ]);

  const fees = [
    { label: "Delivery", cents: settings.oneTimeDeliveryFeeCents },
    { label: "Installation", cents: settings.oneTimeInstallationFeeCents },
    { label: "Pickup / removal", cents: settings.oneTimeRemovalFeeCents },
  ].map((fee) => ({
    label: fee.label,
    value: fee.cents > 0 ? formatCents(fee.cents) : "No charge",
  }));

  return (
    <>
      <section className="border-b border-line bg-surface">
        <Container className="py-16 text-center md:py-20">
          <h1 className="font-display text-4xl font-semibold text-ink">
            Pricing
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-ink-soft">
            Every price below is what {settings.publicBusinessName} actually
            charges — nothing hidden, and it&apos;s locked in for you the day
            you sign, even if prices change later for new customers.
          </p>
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
                  alt={catalogAlt(content, type.slug, type.name)}
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
                {type.slug === "washer-dryer-set" && (
                  <p className="mt-2 text-sm font-medium text-accent-dark">
                    Cheaper than renting a washer and dryer separately
                  </p>
                )}
                <div className="mt-6">
                  <ButtonLink href="/contact" variant="secondary" className="w-full">
                    Get this one
                  </ButtonLink>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-ink-soft">
            Pricing is being finalized —{" "}
            <Link href="/contact" className="underline hover:text-primary">
              reach out
            </Link>{" "}
            and we&apos;ll quote you directly.
          </p>
        )}

        <p className="mt-8 text-sm text-ink-faint">
          Illustrations are generic and for reference only — the actual
          appliance you receive may vary in brand, model, and color.
        </p>

        <div className="mt-16 grid gap-10 md:grid-cols-2">
          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">
              One-time fees
            </h2>
            <dl className="mt-4 divide-y divide-line rounded-card border border-line bg-surface">
              {fees.map((fee) => (
                <div
                  key={fee.label}
                  className="flex items-center justify-between px-5 py-4"
                >
                  <dt className="text-ink-soft">{fee.label}</dt>
                  <dd className="font-semibold text-ink">{fee.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div>
            <h2 className="font-display text-2xl font-semibold text-ink">
              Good to know
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-ink-soft">
              <li>
                <span className="font-medium text-ink">Terms:</span>{" "}
                month-to-month, 6-month, or 12-month — you choose at signup.
              </li>
              {settings.depositEnabled && (
                <li>
                  <span className="font-medium text-ink">
                    Refundable security deposit:
                  </span>{" "}
                  required, refunded when the appliance is returned in good
                  condition.
                </li>
              )}
              {settings.damageWaiverEnabled && (
                <li>
                  <span className="font-medium text-ink">
                    Optional damage waiver:
                  </span>{" "}
                  available if you&apos;d rather not put down a deposit.
                </li>
              )}
              <li>
                <span className="font-medium text-ink">Sales tax:</span>{" "}
                plus sales tax for your service address, shown on your invoice.
              </li>
              <li>
                <span className="font-medium text-ink">Late fee:</span> a
                grace period of {settings.lateFeeGraceDays} days applies
                before any late fee.
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-16 text-center">
          <ButtonLink href="/contact" variant="primary">
            Get a free quote
          </ButtonLink>
        </div>
      </Container>
    </>
  );
}
