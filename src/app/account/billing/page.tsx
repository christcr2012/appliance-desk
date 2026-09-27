import { getServerSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getInvoicesForCustomer } from "@/domains/billing";
import { formatCents } from "@/domains/pricing/money";
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

  const invoices = await getInvoicesForCustomer(customer.id);

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

      <h2 className="mt-8 text-sm font-medium text-gray-700">Invoice history</h2>
      {invoices.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">
          No invoices yet — one is created automatically each time you&apos;re
          billed.
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white">
          {invoices.map((invoice) => (
            <li key={invoice.id} className="flex items-center justify-between px-4 py-3 text-sm">
              <div>
                <p className="font-medium text-gray-900">Invoice #{invoice.invoiceNumber}</p>
                <p className="text-gray-600">
                  {invoice.billingPeriodStart
                    ? new Date(invoice.billingPeriodStart).toLocaleDateString()
                    : "—"}{" "}
                  · {invoice.status}
                </p>
              </div>
              <p className="font-medium text-gray-900">{formatCents(invoice.amountPaidCents)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
