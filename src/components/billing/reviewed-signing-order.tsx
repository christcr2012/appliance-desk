import { formatCents } from "@/domains/pricing";
import type { ReviewedSigningOrderReadback } from "@/domains/billing/signing-order-readback";

/** Same server-verified, customer-isolated order figures on both signing and owner screens. */
export function ReviewedSigningOrder({ order, context = "signing" }: {
  order: ReviewedSigningOrderReadback; context?: "signing" | "estimate";
}) {
  return (
    <section aria-label="Complete reviewed signing order" className="mt-5 rounded-lg border border-line bg-surface p-4 text-sm">
      <h2 className="font-semibold">Complete reviewed signing order</h2>
      <p className="mt-1 text-ink-soft">
        {order.locations.length} service {order.locations.length === 1 ? "address" : "addresses"}.
        These amounts come from the frozen reviewed order.
        {context === "estimate"
          ? " This is the reviewed order following your preliminary estimate, not a signature or payment request. Each agreement must be signed separately."
          : " This page signs only the agreement for the highlighted address; the combined order is context, not another payment request or proof of receipt."}
      </p>
      <div className="mt-3 space-y-3">
        {order.locations.map(location => (
          <div key={location.agreementId} className="rounded-md border border-line p-3">
            <p className="font-medium">
              {location.serviceAddress}
              {location.current && context === "signing" && <span className="ml-2 text-ink-soft">(this agreement)</span>}
            </p>
            <dl className="mt-2 space-y-1 text-ink-soft">
              <div className="flex justify-between gap-3"><dt>Administrative setup</dt><dd>{formatCents(location.setupFeeCents)}</dd></div>
              <div className="flex justify-between gap-3"><dt>Setup sales tax</dt><dd>{formatCents(location.setupTaxCents)}</dd></div>
              <div className="flex justify-between gap-3"><dt>First-month down payment</dt><dd>{formatCents(location.downPaymentCents)}</dd></div>
              {location.additionalItems.map((item, index) => (
                <div key={item.label + index} className="flex justify-between gap-3">
                  <dt>{item.label}{item.status === "BUSINESS_PAID" ? " (paid by business)" : ""}</dt>
                  <dd>{formatCents(item.amountCents)}</dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 font-semibold text-ink"><dt>Signing amount for this address</dt><dd>{formatCents(location.signingAmountCents)}</dd></div>
            </dl>
          </div>
        ))}
      </div>
      <dl className="mt-3 space-y-1 border-t border-line pt-3">
        <div className="flex justify-between gap-3"><dt>Combined administrative setup</dt><dd>{formatCents(order.totals.setupFeeCents)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Combined setup sales tax</dt><dd>{formatCents(order.totals.setupTaxCents)}</dd></div>
        <div className="flex justify-between gap-3"><dt>Combined down payments</dt><dd>{formatCents(order.totals.downPaymentCents)}</dd></div>
        {order.totals.additionalCents > 0 && (
          <div className="flex justify-between gap-3">
            <dt>Additional reviewed fees, service taxes and refundable reserves</dt>
            <dd>{formatCents(order.totals.additionalCents)}</dd>
          </div>
        )}
        <div className="flex justify-between gap-3 font-semibold"><dt>Combined signing amount across addresses</dt><dd>{formatCents(order.totals.signingAmountCents)}</dd></div>
      </dl>
      <p className="mt-2 text-ink-soft">
        A signature is not a payment receipt. Down payments are credited against
        a first invoice only when that invoice is issued and the credit is verified.
      </p>
    </section>
  );
}
