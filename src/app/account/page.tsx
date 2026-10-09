import { getPortalHome } from "@/domains/portal/workspace";
import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { FilterBar } from "@/components/desk/workspace";

export const metadata = { title: "My account" };

export default async function AccountHomePage({
  searchParams,
}: {
  searchParams: Promise<{ address?: string }>;
}) {
  const data = await getPortalHome((await searchParams).address);

  if (!data) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Welcome" />
        <EmptyState
          title="No rental account attached to this login"
          description="Contact the business if you expected to see an active rental."
        />
      </div>
    );
  }

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Your rental account"
        description="Your rentals, next visit, billing and help in one place."
        primaryAction={{
          href: "/account/maintenance",
          label: "Report a problem",
        }}
        secondaryActions={
          <ButtonLink
            href="/account/maintenance?request=pickup"
            variant="secondary"
          >
            Request pickup
          </ButtonLink>
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
            ...data.properties.map((address) => ({
              href: `/account?address=${encodeURIComponent(address.id)}`,
              label: `${address.line1}${
                address.line2 ? `, ${address.line2}` : ""
              }`,
              active: address.id === data.addressId,
            })),
          ]}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card
          title="What do I rent?"
          description={`${data.activeRentalCount} active rental${
            data.activeRentalCount === 1 ? "" : "s"
          }${data.addressId ? " at this property" : " on this account"}.`}
          actions={
            <ButtonLink href="/account/rentals" variant="secondary">
              View rentals
            </ButtonLink>
          }
        >
          {data.rentals.length ? (
            <ul className="space-y-4">
              {data.rentals.map((agreement) => (
                <li
                  key={agreement.id}
                  className="rounded-card border border-line bg-subtle p-4"
                >
                  <p className="font-semibold text-ink">
                    {agreement.serviceAddress.line1}
                    {agreement.serviceAddress.line2 &&
                      `, ${agreement.serviceAddress.line2}`}
                    , {agreement.serviceAddress.city}
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">
                    {agreement.lines.map((line) => line.label).join(", ")}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-ink">
                    {formatCents(
                      agreement.lines.reduce(
                        (sum, line) => sum + line.monthlyPriceCents,
                        0,
                      ),
                    )}
                    /month
                  </p>
                  {agreement.outOfServicePeriods.map((away) => (
                    <p key={away.id} className="mt-2 text-sm text-ink">
                      Your {away.appliance.applianceType.name.toLowerCase()} has been out for repair since{" "}
                      {formatBusinessDate(away.startedOn)}. When it is back, your next bill gets a credit for every day
                      without it.
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No active rentals"
              description="An agreement awaiting signature or delivery may still be in progress."
            />
          )}

          {data.activeRentalCount > data.rentals.length && (
            <p className="mt-3 text-sm text-ink-soft">
              Showing {data.rentals.length} of {data.activeRentalCount} active
              rentals.
            </p>
          )}
        </Card>

        <Card
          title="What's next?"
          description={`${data.upcomingVisitCount} active visit${
            data.upcomingVisitCount === 1 ? "" : "s"
          }${data.addressId ? " for this property" : " on this account"}.`}
          actions={
            <ButtonLink href="/account/rentals" variant="secondary">
              Visit history
            </ButtonLink>
          }
        >
          {data.nextVisit ? (
            <div>
              <p className="font-semibold text-ink">
                {jobTypeLabel(data.nextVisit.type)}
              </p>
              <p className="mt-1 text-ink">
                {formatBusinessDate(data.nextVisit.scheduledAt!)} ·{" "}
                {formatBusinessTime(data.nextVisit.scheduledAt!)}
              </p>
              {data.nextVisit.scheduledAt! < new Date() && (
                <p className="mt-2 text-sm text-ink-soft">
                  This is the recorded visit time. Contact the business if you
                  need an updated arrival time.
                </p>
              )}
              {data.nextVisit.serviceAddress && (
                <p className="mt-2 text-sm text-ink-soft">
                  {data.nextVisit.serviceAddress.line1}
                  {data.nextVisit.serviceAddress.line2 &&
                    `, ${data.nextVisit.serviceAddress.line2}`}
                  , {data.nextVisit.serviceAddress.city}
                </p>
              )}
            </div>
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
        </Card>

        <Card
          title="Do I owe anything?"
          description="Invoice amounts are separate from your rental rate and may include deposits, fees or tax."
          actions={
            <ButtonLink href="/account/billing" variant="secondary">
              Open billing
            </ButtonLink>
          }
        >
          {data.invoice ? (
            <div>
              <p className="font-semibold text-ink">
                Invoice #{data.invoice.invoiceNumber}
              </p>
              <p className="mt-1 text-2xl font-semibold text-ink">
                {formatCents(
                  Math.max(
                    0,
                    data.invoice.amountDueCents -
                      data.invoice.amountPaidCents,
                  ),
                )}{" "}
                remaining
              </p>
              <p className="mt-2 text-sm text-ink-soft">
                {data.invoice.status === "FAILED"
                  ? "Payment needs attention."
                  : "Open invoice."}{" "}
                Billing shows your full history.
              </p>
              <ButtonLink
                href={`/account/billing/invoice/${data.invoice.id}`}
                variant="quiet"
                className="mt-3"
              >
                View invoice
              </ButtonLink>
            </div>
          ) : (
            <p className="text-sm text-ink-soft">
              No open invoice found
              {data.addressId ? " for this property" : ""}.
            </p>
          )}
        </Card>

        <Card
          title="How do I get help?"
          description={`${data.openRequestCount} open service request${
            data.openRequestCount === 1 ? "" : "s"
          } on this account.`}
        >
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/account/maintenance">
              Report a problem
            </ButtonLink>
            <ButtonLink
              href="/account/maintenance?request=pickup"
              variant="secondary"
            >
              Request pickup
            </ButtonLink>
          </div>
          <p className="mt-3 text-sm text-ink-soft">
            Requests are reviewed by the business. A pickup request does not
            automatically cancel a rental or change billing.
          </p>
        </Card>
      </div>
    </div>
  );
}
