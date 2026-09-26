import type { Metadata } from "next";
import Link from "next/link";
import { Container } from "@/components/site/container";
import { ButtonLink } from "@/components/site/button-link";
import { ApplianceIcon } from "@/components/site/appliance-icon";
import { getBusinessSettings } from "@/domains/settings";
import { getPublishedApplianceTypes, formatCents } from "@/domains/pricing";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple, published monthly pricing for washer and dryer rentals in Colorado — no hidden fees.",
};

export default async function PricingPage() {
  const [settings, applianceTypes] = await Promise.all([
    getBusinessSettings(),
    getPublishedApplianceTypes(),
  ]);

  const fees = [
    settings.oneTimeDeliveryFeeCents > 0
      ? {
          label: "Delivery & installation",
          value: formatCents(settings.oneTimeDeliveryFeeCents),
        }
      : { label: "Delivery & installation", value: "No charge" },
    settings.oneTimeRemovalFeeCents > 0
      ? {
          label: "Pickup / removal",
          value: formatCents(settings.oneTimeRemovalFeeCents),
        }
      : { label: "Pickup / removal", value: "No charge" },
  ];

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
              <div
                key={type.id}
                className="flex flex-col rounded-2xl bg-surface p-8 shadow-sm ring-1 ring-line"
              >
                <ApplianceIcon
                  kind={
                    type.slug === "washer-dryer-set"
                      ? "set"
                      : type.slug === "dryer"
                        ? "dryer"
                        : "washer"
                  }
                  className="h-16 w-auto text-primary"
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
                  <ButtonLink href="/contact" variant="outline" className="w-full">
                    Get this one
                  </ButtonLink>
                </div>
              </div>
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
            <dl className="mt-4 divide-y divide-line rounded-xl bg-surface ring-1 ring-line">
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
                {settings.taxRateConfirmed
                  ? `${(settings.taxRatePermille / 10).toFixed(2)}% applied at invoice time.`
                  : "not yet finalized — will be added at invoice time and shown before you owe anything."}
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
