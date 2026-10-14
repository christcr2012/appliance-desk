import { formatCents } from "@/domains/pricing";
import type { EstimateAllInPreview } from "@/domains/estimates/all-in-preview";

export function OwnerAllInEstimateReview({ preview }: { preview: EstimateAllInPreview }) {
  return (
    <section aria-labelledby="all-in-owner-title" className="mt-5 space-y-3 rounded-lg border border-amber-400 bg-surface p-5 text-sm">
      <div>
        <h2 id="all-in-owner-title" className="font-semibold">All-in offer preparation</h2>
        <p className="mt-1 text-ink-soft" role="status">
          Review required. The figures below are internal diagnostics, not a
          finished customer quote or permission to collect money.
        </p>
        <p className="mt-1 text-ink-soft">
          Complete every service address, required price category, tax jurisdiction,
          legally reviewed policy, and immutable owner-approved quote before sending
          a binding offer. A signed agreement and paid receipt remain independent.
        </p>
      </div>
      {preview.locations.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <caption className="mb-2 text-left text-ink-soft">Known amounts by service address — tax and unresolved fees excluded</caption>
            <thead><tr className="border-b border-line">
              <th className="py-2 pr-3">Location</th><th className="py-2 pr-3">Machines</th>
              <th className="py-2 pr-3">Monthly rent</th><th className="py-2 pr-3">Setup</th>
              <th className="py-2 pr-3">First-month advance</th><th className="py-2">Quoted one-time</th>
            </tr></thead>
            <tbody>
              {preview.locations.map(location => (
                <tr key={location.serviceAddressId} className="border-b border-line">
                  <td className="py-2 pr-3">{location.addressLabel}</td>
                  <td className="py-2 pr-3">{location.machines}</td>
                  <td className="py-2 pr-3">{formatCents(location.monthlyRentCents)}</td>
                  <td className="py-2 pr-3">{formatCents(location.setupFeeCents)}</td>
                  <td className="py-2 pr-3">{formatCents(location.firstMonthDownPaymentCents)}</td>
                  <td className="py-2">{formatCents(location.quotedOneTimeCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p>Assign each line to a real service address and inventory package before reviewing money.</p>}
      {preview.known && (
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="text-ink-soft">Recurring monthly lines</dt><dd>{formatCents(preview.known.monthlyRentCents)}</dd></div>
          <div><dt className="text-ink-soft">Known one-time estimate lines</dt><dd>{formatCents(preview.known.quotedOneTimeCents)}</dd></div>
          <div><dt className="text-ink-soft">Setup fees (tax excluded)</dt><dd>{formatCents(preview.known.setupFeeCents)}</dd></div>
          <div><dt className="text-ink-soft">First-month advance (future invoice credit)</dt><dd>{formatCents(preview.known.firstMonthDownPaymentCents)}</dd></div>
          <div><dt className="text-ink-soft">Requested deposit (separate)</dt><dd>{formatCents(preview.known.requestedDepositCents)}</dd></div>
          <div><dt className="text-ink-soft">Known subtotal — NOT all-in or payable</dt><dd>{formatCents(preview.known.knownSubtotalCents)}</dd></div>
        </dl>
      )}
      <div>
        <h3 className="font-medium">Still required before a binding all-in price</h3>
        <ul className="mt-1 list-inside list-disc text-ink-soft">
          {preview.reasons.map(reason => <li key={reason}>{reason}</li>)}
        </ul>
      </div>
      <p className="font-medium text-ink">No estimate approval, deposit or Stripe collection is authorized by this preview.</p>
    </section>
  );
}
