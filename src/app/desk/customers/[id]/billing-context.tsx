import Link from "next/link";
import { formatCents } from "@/domains/pricing/money";
import { getCustomerBillingContext } from "@/domains/customers/workspace";

export async function BillingContext({ id }: { id: string }) {
  const customer = await getCustomerBillingContext(id);
  if (!customer) return null;
  return (
    <>
      <Link
        href={`/desk/billing/customer/${id}`}
        className="inline-flex min-h-11 items-center text-primary underline"
      >
        Open invoices, payments and customer statement
      </Link>
      <div className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Referral program</h2>
        <p className="mt-2 text-sm text-gray-600">
          Their code:{" "}
          <span className="font-mono font-semibold text-gray-900">
            {customer.referralCode}
          </span>
          {" — "}give it to friends; when someone they refer signs up and starts
          paying, you both get a credit.
        </p>

        {customer.referredBy && (
          <p className="mt-2 text-sm text-gray-700">
            Referred by{" "}
            <Link
              href={`/desk/customers/${customer.referredBy.referrerCustomerId}`}
              className="hover:underline"
            >
              {customer.referredBy.referrerCustomer.user.name ??
                customer.referredBy.referrerCustomer.user.email}
            </Link>{" "}
            —{" "}
            {customer.referredBy.status === "REWARDED"
              ? "reward already applied"
              : "reward pending (waiting for billing to start)"}
          </p>
        )}

        {customer.referralsMade.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-900">
              People they&apos;ve referred
            </p>
            <ul className="mt-1 space-y-1 text-sm text-gray-700">
              {customer.referralsMade.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/desk/customers/${r.referredCustomerId}`}
                    className="hover:underline"
                  >
                    {r.referredCustomer.user.name ??
                      r.referredCustomer.user.email}
                  </Link>{" "}
                  — {r.status === "REWARDED" ? "reward applied" : "pending"}
                </li>
              ))}
            </ul>
          </div>
        )}

        {customer.credits.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium text-gray-900">Account credits</p>
            <ul className="mt-1 space-y-1 text-sm text-gray-700">
              {customer.credits.map((c) => (
                <li key={c.id}>
                  {formatCents(c.remainingCents)} remaining of{" "}
                  {formatCents(c.amountCents)} — {c.reason}
                  {c.notes ? ` (${c.notes})` : ""}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
