import Link from "next/link";
import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getCustomerStatement } from "@/domains/billing";
import { formatCents } from "@/domains/pricing/money";
import { invoiceStatusLabel } from "@/lib/status-labels";
import { ManageBillingButton } from "./manage-billing-button";

export const metadata = { title: "Billing" };

export default async function AccountBillingPage() {
  const session = await getServerSession();
  const customer = session ? await getPortalData(session.user.id) : null;

  if (!customer) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Billing</h1>
        <p className="mt-2 text-gray-600">
          There&apos;s no rental account attached to this login yet.
        </p>
      </div>
    );
  }

  const statement = await getCustomerStatement(customer.id);
  const hasMultipleProperties = (statement?.properties.length ?? 0) > 1;

  return (
    <div>
      <h1 className="text-xl font-semibold">Billing</h1>
      <p className="mt-1 text-sm text-gray-600">
        Update your card or bank account, and download past invoices,
        through Stripe&apos;s secure billing page.
      </p>
      <div className="mt-4">
        <ManageBillingButton />
      </div>

      {statement && statement.totalBalanceCents > 0 && (
        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-900">
            {formatCents(statement.totalBalanceCents)} currently owed
            {hasMultipleProperties ? " across all your properties" : ""}.
          </p>
        </div>
      )}

      {/* Grouped by property once there's more than one — a property
          manager's whole portfolio in one place instead of a flat list
          with no indication which invoice belongs to which building
          (docs/BUSINESS-RULES.md's "Property managers / portfolio
          accounts"). A single-property customer just sees one section,
          no different from the old flat list. */}
      {!statement || statement.properties.length === 0 ? (
        <p className="mt-8 text-sm text-gray-600">
          No invoices yet — one is created automatically each time you&apos;re
          billed.
        </p>
      ) : (
        <div className="mt-8 space-y-6">
          {statement.properties.map((property) => (
            <div key={property.serviceAddressId ?? "no-property"}>
              {hasMultipleProperties && (
                <h2 className="text-sm font-medium text-gray-700">{property.addressLabel}</h2>
              )}
              <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
                {property.invoices.map((invoice) => (
                  <li key={invoice.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <Link
                        href={`/account/billing/invoice/${invoice.id}`}
                        className="font-medium text-gray-900 hover:underline"
                      >
                        Invoice #{invoice.invoiceNumber}
                      </Link>
                      <p className="text-gray-600">
                        {invoice.billingPeriodStart
                          ? new Date(invoice.billingPeriodStart).toLocaleDateString()
                          : "—"}{" "}
                        · {invoiceStatusLabel(invoice.status)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-gray-900">{formatCents(invoice.amountPaidCents)}</p>
                      {invoice.balanceCents > 0 && (
                        <p className="text-xs text-amber-700">{formatCents(invoice.balanceCents)} owed</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
