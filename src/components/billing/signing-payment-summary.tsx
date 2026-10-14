import { formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing/money";
import type { CustomerSigningSummary } from "@/domains/portal/signing-status";

/**
 * One presentation for the customer portal and owner desk. The DTO is
 * customer-isolated and verifies the exact signed obligation against its
 * own settled receipt before it permits a "received" statement.
 *
 * No raw receipt, provider identifiers, provisional quote, or inferred
 * first-invoice credit are exposed by this component.
 */
export function SigningPaymentSummary({ summary }: {
  summary: CustomerSigningSummary | null;
}) {
  if (!summary) return null;
  if (summary.status === "REVIEW_REQUIRED" ||
      [summary.setupFeeCents, summary.setupTaxCents,
        summary.downPaymentCents, summary.totalCents].some(value =>
          value === null || !Number.isSafeInteger(value) || value < 0)) {
    return (
      <section aria-label="Signing payment" className="mt-3 rounded-card border border-line bg-subtle p-3 text-sm" role="status">
        <h3 className="font-medium text-ink">Signing payment needs review</h3>
        <p className="mt-1 text-ink-soft">
          We cannot confirm the signed amount or payment from the records available.
          Contact the business before making another payment.
        </p>
      </section>
    );
  }

  const received = summary.status === "RECEIVED" &&
    summary.receivedOn instanceof Date &&
    Number.isFinite(summary.receivedOn.getTime());
  const notDue = summary.status === "NOT_DUE";
  return (
    <section aria-label="Signing payment" className="mt-3 rounded-card border border-line bg-subtle p-3 text-sm" role="status">
      <h3 className="font-medium text-ink">Signing charge breakdown</h3>
      <dl className="mt-2 space-y-1 text-ink-soft">
        <div className="flex justify-between gap-3"><dt>Administrative setup</dt><dd>{formatCents(summary.setupFeeCents!)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Setup sales tax</dt><dd>{formatCents(summary.setupTaxCents!)}</dd></div>
        <div className="flex justify-between gap-3"><dt>First-month down payment</dt><dd>{formatCents(summary.downPaymentCents!)}</dd></div>
        <div className="flex justify-between gap-3 border-t border-line pt-2 font-semibold text-ink">
          <dt>Signed signing amount</dt><dd>{formatCents(summary.totalCents!)}</dd>
        </div>
      </dl>
      {notDue ? (
        <p className="mt-2 text-ink-soft">No signing payment is due under this signed agreement.</p>
      ) : received ? (
        <p className="mt-2 text-ink">Signing payment recorded as received on {formatBusinessDate(summary.receivedOn!)}.</p>
      ) : (
        <p className="mt-2 text-ink-soft">
          Signing amount awaiting verified payment. A signature or payment attempt is not a receipt.
        </p>
      )}
      <p className="mt-1 text-ink-soft">
        Money received at signing is separate from the first delivery invoice.
        Any down payment is credited only when that invoice is actually issued.
      </p>
    </section>
  );
}
