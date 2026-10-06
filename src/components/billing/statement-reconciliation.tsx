import { formatCents } from "@/domains/pricing/money";
import type { StatementReconciliation } from "@/domains/billing";

/** Shows how a statement's balance adds up, line by line, with a plain warning when it does not. */
export function StatementReconciliationCard({
  reconciliation: r,
}: {
  reconciliation: StatementReconciliation;
}) {
  const rows: Array<[string, string, boolean?]> = [
    ["Carried forward from earlier invoices", formatCents(r.carriedForwardCents)],
    ["Billed (non-draft, non-voided invoices)", formatCents(r.invoicedCents)],
    ["Payments applied", `− ${formatCents(r.paymentsAppliedCents)}`],
    ["Account credit applied", `− ${formatCents(r.creditsAppliedCents)}`],
    ["Written off", `− ${formatCents(r.writtenOffCents)}`],
    ["Balance owed", formatCents(r.closingBalanceCents), true],
  ];
  return (
    <section
      aria-labelledby="statement-reconciliation-heading"
      className="mt-6 rounded-lg border border-line bg-white p-5"
    >
      <h2 id="statement-reconciliation-heading" className="font-medium text-ink">
        How this balance adds up
      </h2>
      <dl className="mt-3 space-y-1 text-sm">
        {rows.map(([label, value, strong]) => (
          <div
            key={label}
            className={`flex justify-between gap-4 ${strong ? "border-t border-line pt-2 font-semibold" : ""}`}
          >
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {!r.balanced && (
        <p role="alert" className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
          These numbers do not add up: an invoice&apos;s paid amount does not match its recorded
          payments and credits. Review the invoices below before relying on this balance.
        </p>
      )}
      <p className="mt-3 text-sm text-ink-soft">
        Refunds recorded on these invoices: {formatCents(r.refundedCents)} (they do not reopen an
        invoice, so they are not part of the balance). Unspent account credit:{" "}
        {formatCents(r.creditAvailableCents)}.
      </p>
    </section>
  );
}
