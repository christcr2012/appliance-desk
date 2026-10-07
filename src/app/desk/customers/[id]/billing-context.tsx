import Link from "next/link";
import { formatCents } from "@/domains/pricing/money";
import { getCustomerBillingContext } from "@/domains/customers/workspace";
import {
  listCustomerTaxExemptionJurisdictions,
  listCustomerTaxExemptions,
} from "@/domains/tax/exemptions";
import { businessDateKey } from "@/lib/business-date";
import { requireRole } from "@/lib/session";
import { TaxExemptionsPanel } from "./tax-exemptions-panel";

export async function BillingContext({ id }: { id: string }) {
  const session = await requireRole("OWNER", "ADMIN");
  const customer = await getCustomerBillingContext(id);
  if (!customer) return null;
  const [exemptions, jurisdictions] = await Promise.all([
    listCustomerTaxExemptions(session.user.id, id),
    listCustomerTaxExemptionJurisdictions(session.user.id, id),
  ]);
  const canEdit = (session.user as { role?: string }).role === "OWNER";
  return (
    <>
      <Link
        href={`/desk/billing/customer/${id}`}
        className="inline-flex min-h-11 items-center text-primary underline"
      >
        Open invoices, payments and customer statement
      </Link>
      <div className="mt-6 rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">Referral program</h2>
        <p className="mt-2 text-sm text-ink-soft">
          Their code:{" "}
          <span className="font-mono font-semibold text-ink">
            {customer.referralCode}
          </span>
          {" — "}give it to friends; when someone they refer signs up and starts
          paying, you both get a credit.
        </p>

        {customer.referredBy && (
          <p className="mt-2 text-sm text-ink-soft">
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
            <p className="text-sm font-medium text-ink">
              People they&apos;ve referred
            </p>
            <ul className="mt-1 space-y-1 text-sm text-ink-soft">
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
            <p className="text-sm font-medium text-ink">Account credits</p>
            <ul className="mt-1 space-y-1 text-sm text-ink-soft">
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
      <TaxExemptionsPanel
        customerId={id}
        canEdit={canEdit}
        jurisdictions={jurisdictions}
        exemptions={exemptions.map((exemption) => ({
          id: exemption.id,
          reason: exemption.reason,
          certificateNumber: exemption.certificateNumber,
          certificatePhotoId: exemption.certificatePhotoId,
          jurisdictionIds: Array.isArray(exemption.jurisdictionIds)
            ? exemption.jurisdictionIds.filter(
                (value): value is string => typeof value === "string",
              )
            : [],
          validFrom: businessDateKey(exemption.validFrom),
          expiresOn: exemption.expiresOn
            ? businessDateKey(exemption.expiresOn)
            : null,
          revokedAt: exemption.revokedAt
            ? exemption.revokedAt.toISOString()
            : null,
          notes: exemption.notes,
        }))}
      />
    </>
  );
}
