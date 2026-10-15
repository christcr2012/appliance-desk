import { formatCents } from "@/domains/pricing";
import type { EstimatePreparedQuote } from "@/domains/estimates/preapproval-quote";

export function ReviewedPreapprovalQuote({ quote, owner = false }: {
  quote: EstimatePreparedQuote;
  owner?: boolean;
}) {
  if (quote.status !== "READY" || !quote.totals) {
    return (
      <section aria-label="Estimate price readiness" className="mt-5 rounded border border-amber-400 p-4 text-sm">
        <h2 className="font-semibold">Complete all-in offer requires review</h2>
        <p className="mt-1 text-ink-soft">
          Preliminary rental amounts are not a price that may be accepted, signed or paid.
          The owner must reconcile every location, package, tax and applicable mandatory charge.
        </p>
        {owner && (
          <ul className="mt-2 list-inside list-disc text-ink-soft">
            {quote.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby="reviewed-quote-title" className="mt-5 space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <h2 id="reviewed-quote-title" className="text-base font-semibold">
        Reviewed offer — exact prepared agreement locations
      </h2>
      <p className="text-ink-soft">
        This offer is based on the same frozen signing order used for the individual
        rental agreements. Monthly rental tax is calculated from currently verified
        jurisdiction rates; legally applicable rate changes at invoicing may change
        future bill tax. A reviewed offer is not a payment receipt or delivery booking.
      </p>
      <div className="overflow-x-auto" role="region" aria-label="Scrollable per-address reviewed money" tabIndex={0}>
        <table className="w-full text-left">
          <caption className="mb-2 text-left text-ink-soft">
            Tax and signing amounts per service address
          </caption>
          <thead><tr className="border-b border-line">
            <th className="py-2 pr-3">Property</th>
            <th className="py-2 pr-3">Monthly rent</th>
            <th className="py-2 pr-3">Monthly tax</th>
            <th className="py-2 pr-3">Setup + tax</th>
            <th className="py-2">Signing advance</th>
          </tr></thead>
          <tbody>
            {quote.locations.map(row => (
              <tr key={row.agreementId} className="border-b border-line">
                <td className="py-2 pr-3">{row.serviceAddress}</td>
                <td className="py-2 pr-3">{formatCents(row.monthlyRentCents)}</td>
                <td className="py-2 pr-3">{formatCents(row.monthlyRentTaxCents)}</td>
                <td className="py-2 pr-3">{formatCents(row.setupFeeCents + row.setupTaxCents)}</td>
                <td className="py-2">
                  {formatCents(row.advanceCents)}
                  {(row.additionalItems ?? []).map((item, index) => (
                    <p key={item.label + index} className="text-xs text-ink-soft">
                      {item.label}: {item.status === "BUSINESS_PAID" ?
                        "Paid by business" : formatCents(item.amountCents)}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-ink-soft">Monthly rent</dt>
          <dd className="font-medium">{formatCents(quote.totals.monthlyRentCents)}</dd></div>
        <div><dt className="text-ink-soft">Calculated monthly tax</dt>
          <dd className="font-medium">{formatCents(quote.totals.monthlyRentTaxCents)}</dd></div>
        <div><dt className="text-ink-soft">One-time setup charges</dt>
          <dd className="font-medium">{formatCents(quote.totals.setupFeeCents)}</dd></div>
        <div><dt className="text-ink-soft">One-time setup tax</dt>
          <dd className="font-medium">{formatCents(quote.totals.setupTaxCents)}</dd></div>
        <div><dt className="text-ink-soft">First-month advance (credited to first invoice)</dt>
          <dd className="font-medium">{formatCents(quote.totals.advanceCents)}</dd></div>
        <div><dt className="text-ink-soft">Due at signing, not yet paid</dt>
          <dd className="font-semibold">{formatCents(quote.totals.dueAtSigningCents)}</dd></div>
      </dl>
      <p className="text-xs text-ink-soft">
        Signing funds are independently verified. The first rental invoice
        applies any valid advance only once. No deposit checkout is automatically initiated.
        The complete applicable terms must also receive any required legal and owner approval.
      </p>
      {owner && <p className="font-mono text-xs break-all">Quote fingerprint: {quote.quoteFingerprint}</p>}
    </section>
  );
}
