import { StatusPill } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import { RECAPTURE_WARNING, RESALE_STATUS_LABEL, type ResaleTaxEstimate } from "@/domains/sales/retired-sale-tax";

/**
 * What the owner sees about the income-tax side of selling a retired appliance: always the warning, a plain badge for
 * how sure the numbers are, and (only when somebody recorded the tax history) the estimate. It is the same on the
 * new-sale screen and on the saved sale, and it never blocks anything.
 */
export function ResaleTaxNote({ estimate, bookValueCents }: { estimate: ResaleTaxEstimate; bookValueCents?: number | null }) {
  const numbers = estimate.taxGainCents !== null;
  return (
    <div className="rounded-control border border-line bg-surface-subtle p-3 text-sm space-y-2 sm:col-span-2" data-testid="resale-tax-note">
      <p className="font-semibold">{RECAPTURE_WARNING}</p>
      <StatusPill tone={estimate.status === "CPA_CONFIRMED_ESTIMATE" ? "success" : "attention"} label={RESALE_STATUS_LABEL[estimate.status]} />
      {typeof bookValueCents === "number" && (
        <p className="text-ink-soft">Still on your books: {formatMoney(bookValueCents)}. That comes off the books when you save. It is not the same as the tax figures below.</p>
      )}
      {numbers ? (
        <dl className="space-y-1">
          <div className="flex justify-between gap-3"><dt>Price after your selling costs</dt><dd>{formatMoney(estimate.netProceedsCents)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Tax basis left after depreciation</dt><dd>{formatMoney(estimate.adjustedBasisCents ?? 0)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Gain or loss for income tax (estimate)</dt><dd>{formatMoney(estimate.taxGainCents ?? 0)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Most that may be taxed as ordinary income (depreciation recapture)</dt><dd>{formatMoney(estimate.potentialRecaptureCents ?? 0)}</dd></div>
          <div className="flex justify-between gap-3"><dt>Rest of the gain, for your accountant to sort out</dt><dd>{formatMoney(estimate.otherGainCents ?? 0)}</dd></div>
          <p className="text-ink-soft">These are amounts of income, not money owed. Tax due is not calculated here; your accountant works that out.</p>
        </dl>
      ) : (
        <p className="text-ink-soft">No tax estimate is shown because the tax history for this appliance is not complete. You can still sell it at your price.</p>
      )}
      {estimate.reasons.length > 0 && (
        <ul className="list-disc pl-5 text-ink-soft">
          {estimate.reasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </div>
  );
}
