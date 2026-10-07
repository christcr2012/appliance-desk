import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import Link from "next/link";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getCustomerStatement } from "@/domains/billing";
import { formatCents } from "@/domains/pricing/money";
import {
  invoiceStatusLabel,
  invoiceStatusTone,
} from "@/lib/status-labels";
import {
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatusPill,
} from "@/components/ui";
import { ManageBillingButton } from "./manage-billing-button";

export const metadata = { title: "Billing" };

function previousBusinessMonth(): string {
  const current = businessDateKey(new Date()).slice(0, 7);
  const [year, month] = current.split("-").map(Number);
  return new Date(Date.UTC(year, month - 2, 1)).toISOString().slice(0, 7);
}

export default async function AccountBillingPage() {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Billing" />
        <EmptyState
          title="No rental account attached to this login"
          description="Contact the business if you expected to see billing history here."
        />
      </div>
    );
  }

  const statement = await getCustomerStatement(customer.id, { customerVisible: true });
  const hasMultipleProperties = (statement?.properties.length ?? 0) > 1;
  const statementMonth = previousBusinessMonth();

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Billing"
        description="Update your payment method and review your recorded invoice history."
        secondaryActions={
          <ButtonLink
            href={`/api/documents/statement/${statementMonth}`}
            target="_blank"
            variant="secondary"
          >
            View {statementMonth} frozen statement
          </ButtonLink>
        }
      />

      <div className="mb-6">
        <Card
          title="Payment method"
          description="Stripe opens a secure billing page for card or bank-account changes."
        >
          <ManageBillingButton />
        </Card>
      </div>

      {statement && statement.totalBalanceCents > 0 && (
        <div className="mb-6 rounded-card border border-warning-ink bg-warning-bg p-4">
          <p className="font-semibold text-warning-ink">
            {formatCents(statement.totalBalanceCents)} currently owed
            {hasMultipleProperties ? " across all your properties" : ""}.
          </p>
        </div>
      )}

      <p className="mb-6 text-sm text-ink-soft">
        Invoice amounts can include deposits, fees and tax. A required deposit
        is separate from a confirmed payment. Payment status shows the last
        recorded update.
      </p>

      {!statement || statement.properties.length === 0 ? (
        <EmptyState
          title="No invoices yet"
          description="An invoice is created automatically each time you're billed."
        />
      ) : (
        <div className="space-y-6">
          {statement.properties.map((property) => (
            <Card
              key={property.serviceAddressId ?? "no-property"}
              title={hasMultipleProperties ? property.addressLabel : "Invoices"}
              description={
                hasMultipleProperties
                  ? "Invoices recorded for this property."
                  : undefined
              }
            >
              <ul className="divide-y divide-line">
                {property.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/account/billing/invoice/${invoice.id}`}
                        className="font-semibold text-ink underline-offset-4 hover:underline"
                      >
                        Invoice #{invoice.invoiceNumber}
                      </Link>
                      <p className="mt-1 text-sm text-ink-soft">
                        {invoice.billingPeriodStart
                          ? formatBusinessDate(invoice.billingPeriodStart)
                          : "—"}
                      </p>
                      <div className="mt-2">
                        <StatusPill
                          tone={invoiceStatusTone(invoice.status)}
                          label={invoiceStatusLabel(invoice.status)}
                        />
                      </div>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-semibold text-ink">
                        {formatCents(invoice.amountPaidCents)} paid
                      </p>
                      {invoice.balanceCents > 0 && (
                        <p className="mt-1 text-sm font-semibold text-warning-ink">
                          {formatCents(invoice.balanceCents)} owed
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
