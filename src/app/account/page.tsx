import Link from "next/link";
import { getPortalHome } from "@/domains/portal/workspace";
import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import {
  PageHeader,
  SectionCard,
  EmptyState,
  FilterBar,
  Metric,
  primaryActionClass,
  secondaryActionClass,
} from "@/components/desk/workspace";
export const metadata = { title: "My account" };
export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const data = await getPortalHome((await searchParams).address);
  if (!data)
    return (
      <div>
        <PageHeader title="Welcome" />
        <EmptyState
          title="No rental account attached to this login"
          description="Contact the business if you expected to see an active rental."
        />
      </div>
    );
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        title="Your rental account"
        description="Your rentals, next visit, billing and help in one place."
        primaryAction={
          <Link className={primaryActionClass} href="/account/maintenance">
            Report a problem
          </Link>
        }
        secondaryActions={
          <Link
            className={secondaryActionClass}
            href="/account/maintenance?request=pickup"
          >
            Request pickup
          </Link>
        }
      />
      {data.properties.length > 1 && (
        <FilterBar
          label="Account properties"
          items={[
            {
              href: "/account",
              label: "All properties",
              active: !data.addressId,
            },
            ...data.properties.map((a) => ({
              href: `/account?address=${encodeURIComponent(a.id)}`,
              label: `${a.line1}${a.line2 ? `, ${a.line2}` : ""}`,
              active: a.id === data.addressId,
            })),
          ]}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric
          label="Active rentals"
          value={data.activeRentalCount}
          href="/account/rentals"
          basis={data.addressId ? "Selected property" : "All properties"}
        />
        <Metric
          label="Active visits"
          value={data.upcomingVisitCount}
          href="/account/rentals"
          basis={data.addressId ? "Selected property" : "All properties"}
        />
        <Metric
          label="Open service requests"
          value={data.openRequestCount}
          href="/account/maintenance"
          basis="Entire account"
        />
      </div>
      <SectionCard title="Your next visit">
        {data.nextVisit ? (
          <>
            <p className="font-semibold text-ink">
              {jobTypeLabel(data.nextVisit.type)}
            </p>
            <p className="mt-1 text-ink">
              {formatBusinessDate(data.nextVisit.scheduledAt!)} ·{" "}
              {formatBusinessTime(data.nextVisit.scheduledAt!)}
            </p>
            {data.nextVisit.scheduledAt! < new Date() && (
              <p className="mt-1 text-sm text-ink-soft">
                This is the recorded visit time. Contact the business if you
                need an updated arrival time.
              </p>
            )}
            {data.nextVisit.serviceAddress && (
              <p className="mt-1 text-sm text-ink-soft">
                {data.nextVisit.serviceAddress.line1}
                {data.nextVisit.serviceAddress.line2 &&
                  `, ${data.nextVisit.serviceAddress.line2}`}
                , {data.nextVisit.serviceAddress.city}
              </p>
            )}
            <Link
              className="mt-3 inline-flex min-h-11 items-center text-primary underline"
              href="/account/rentals"
            >
              View visit and rental history
            </Link>
          </>
        ) : (
          <EmptyState
            title="No scheduled visit"
            description={
              data.upcomingVisitCount
                ? "A visit is being arranged; a date has not been set yet."
                : "New visit details will appear once the business schedules them."
            }
          />
        )}
      </SectionCard>
      <SectionCard
        title="Billing"
        description="Invoice amounts are separate from your rental rate and may include deposits, fees or tax."
      >
        {data.invoice ? (
          <>
            <Link
              className="text-primary underline"
              href={`/account/billing/invoice/${data.invoice.id}`}
            >
              Invoice #{data.invoice.invoiceNumber}:{" "}
              {formatCents(
                Math.max(
                  0,
                  data.invoice.amountDueCents - data.invoice.amountPaidCents,
                ),
              )}{" "}
              remaining
            </Link>
            <p className="mt-1 text-sm text-ink-soft">
              {data.invoice.status === "FAILED"
                ? "Payment needs attention"
                : "Open invoice"}
              . This is one invoice; billing shows your full history.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-soft">
            No open invoice found{data.addressId ? " for this property" : ""}.
          </p>
        )}
        <Link
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
          href="/account/billing"
        >
          Open billing and payment history
        </Link>
      </SectionCard>
      <SectionCard title="Your active rentals">
        {data.rentals.length ? (
          <>
            <ul className="space-y-4">
              {data.rentals.map((a) => (
                <li key={a.id}>
                  <p className="font-medium text-ink">
                    {a.serviceAddress.line1}
                    {a.serviceAddress.line2 &&
                      `, ${a.serviceAddress.line2}`}, {a.serviceAddress.city}
                  </p>
                  <p className="text-sm text-ink-soft">
                    {a.lines.map((l) => l.label).join(", ")} ·{" "}
                    {formatCents(
                      a.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0),
                    )}
                    /month
                  </p>
                </li>
              ))}
            </ul>
            {data.activeRentalCount > data.rentals.length && (
              <p className="mt-3 text-sm text-ink-soft">
                Showing {data.rentals.length} of {data.activeRentalCount} active
                rentals.
              </p>
            )}
          </>
        ) : (
          <EmptyState
            title="No active rentals"
            description="An agreement awaiting signature or delivery may still be in progress."
          />
        )}
        <Link
          className="mt-3 inline-flex min-h-11 items-center text-primary underline"
          href="/account/rentals"
        >
          View all rental details
        </Link>
      </SectionCard>
    </div>
  );
}
