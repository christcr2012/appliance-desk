import { getEstimateForApproval } from "@/domains/estimates";
import { estimateValidThroughKey } from "@/domains/estimates/validity";
import { businessDateFromKey, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing";
import { EstimateResponseForm } from "./estimate-response-form";
import { PayDepositButton } from "./pay-deposit-button";
import { getFinalizedConvertedEstimateOrder } from "@/domains/estimates/finalized-order";
import { ReviewedSigningOrder } from "@/components/billing/reviewed-signing-order";
import { getPreparedEstimateQuote } from "@/domains/estimates/preapproval-quote";
import { ReviewedPreapprovalQuote } from "@/components/estimates/reviewed-preapproval-quote";
import { readOfferedSlots } from "@/domains/orders/delivery";

export const metadata = {
  title: "Your estimate",
  robots: { index: false, follow: false },
};

const RESPONDED_STATUSES = new Set(["APPROVED", "CHANGES_REQUESTED", "DECLINED", "EXPIRED", "CONVERTED"]);

export default async function PublicEstimatePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const estimate = await getEstimateForApproval(id);

  if (!estimate) {
    return (
      <main className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">This link isn&apos;t available</h1>
        <p className="mt-3 text-ink-soft">
          This estimate may not have been sent yet, or the link may no
          longer be valid. If you think this is a mistake, contact us
          directly.
        </p>
      </main>
    );
  }

  const reviewedOrder = estimate.status === "CONVERTED"
    ? await getFinalizedConvertedEstimateOrder(estimate.id) : null;
  const quoteCandidate = estimate.status !== "CONVERTED"
    ? await getPreparedEstimateQuote(estimate.id) : null;
  const quoteIsCurrent = quoteCandidate?.status === "READY" &&
    quoteCandidate.quoteFingerprint === estimate.reviewedQuoteFingerprint &&
    quoteCandidate.orderFingerprint === estimate.reviewedOrderFingerprint;
  const reviewedQuote = quoteIsCurrent ? quoteCandidate : null;
  const monthly = estimate.lineItems.reduce((sum, l) => sum + l.monthlyPriceCents * l.quantity, 0);
  const oneTime = estimate.lineItems.reduce((sum, l) => sum + l.oneTimeFeeCents * l.quantity, 0);
  const customerName = estimate.customer
    ? (estimate.customer.user.name ?? estimate.customer.user.email)
    : estimate.lead?.contactName;

  return (
    <main className="mx-auto max-w-lg px-6 py-16">
      <h1 className="text-xl font-semibold">Estimate #{estimate.estimateNumber}</h1>
      <p className="mt-2 text-sm text-ink-soft">Prepared for {customerName}</p>

      {estimate.clientMessage && (
        <p className="mt-4 whitespace-pre-line text-sm text-ink-soft">{estimate.clientMessage}</p>
      )}

      <p className="mt-4 text-sm text-ink-soft" role="note">
        These estimate line items are preliminary rental and one-time figures,
        not a finalized all-in signing price. Mandatory setup charges, location taxes,
        down payments and other applicable fees must be reviewed separately before
        a binding rental agreement is signed.
      </p>
      <div className="mt-6 space-y-3 rounded-lg border border-line bg-surface p-5 text-sm">
        <ul className="divide-y divide-line">
          {estimate.lineItems.map((line) => (
            <li key={line.id} className="py-2">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-ink">
                    {line.quantity > 1 ? `${line.quantity}× ` : ""}
                    {line.description}
                  </p>
                  {line.serviceAddress && (
                    <p className="text-xs text-ink-faint">
                      {line.serviceAddress.line1}, {line.serviceAddress.city}
                    </p>
                  )}
                </div>
                <div className="text-right text-ink-soft">
                  {line.monthlyPriceCents > 0 && <p>{formatCents(line.monthlyPriceCents)}/mo</p>}
                  {line.oneTimeFeeCents > 0 && <p>{formatCents(line.oneTimeFeeCents)} one-time</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-line pt-3 font-medium text-ink">
          {monthly > 0 && <p>{formatCents(monthly)}/month</p>}
          {oneTime > 0 && <p>{formatCents(oneTime)} one-time</p>}
        </div>
        {estimate.depositCents > 0 && <p>Deposit: {formatCents(estimate.depositCents)}</p>}
        {estimate.validUntil && (
          <p className="text-xs text-ink-faint">
            Valid through {formatBusinessDate(businessDateFromKey(estimateValidThroughKey(estimate.validUntil))!)}
          </p>
        )}
      </div>

      {reviewedQuote && <ReviewedPreapprovalQuote quote={reviewedQuote} />}
      {(estimate.status === "SENT" || estimate.status === "VIEWED") && !reviewedQuote && (
        <section className="mt-4 rounded border border-amber-400 p-4 text-sm" role="alert">
          The reviewed all-in offer needs to be refreshed before you can approve it.
          Please request changes or contact the business. Preliminary figures are not binding.
        </section>
      )}
      {reviewedOrder?.status === "FINAL_REVIEWED" && (
        <ReviewedSigningOrder order={reviewedOrder.order} context="estimate" />
      )}
      {estimate.status === "CONVERTED" && reviewedOrder?.status !== "FINAL_REVIEWED" && (
        <section aria-label="Final reviewed price pending" className="mt-5 rounded-lg border border-line bg-subtle p-4 text-sm" role="status">
          <h2 className="font-semibold">Your complete order price is being reviewed</h2>
          <p className="mt-1 text-ink-soft">
            An all-in signing total is not yet available for every service address.
            Contact the business before treating these preliminary figures as final.
            No amount on this page proves payment or a confirmed delivery appointment.
          </p>
        </section>
      )}
      <div className="mt-6">
        {estimate.status === "APPROVED" && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
            <p className="font-medium">You approved this estimate.</p>
            {estimate.depositCents > 0 && estimate.depositPaidAt && (
              <p className="mt-1">
                Deposit of {formatCents(estimate.depositCents)} received — thank you.
              </p>
            )}
            {reviewedQuote?.evidenceVersion===2 ? (
              <p className="mt-1">The refundable reserve is included in the reviewed signing amount. Review and sign the agreement before paying; no separate estimate deposit is due.</p>
            ) : estimate.depositCents > 0 && !estimate.depositPaidAt ? (
              <>
                <p className="mt-1">
                  One more step: a deposit of {formatCents(estimate.depositCents)} is due before
                  we can move forward.
                </p>
                {reviewedQuote ? <PayDepositButton estimateId={estimate.id} /> : (
                  <p className="mt-1">Deposit checkout requires a renewed, verified complete signing order.</p>
                )}
              </>
            ) : (
              <p className="mt-1">We&apos;ll be in touch about next steps.</p>
            )}
          </div>
        )}
        {estimate.status === "CHANGES_REQUESTED" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-medium">We got your request for changes.</p>
            <p className="mt-1">We&apos;ll follow up with a revised estimate.</p>
          </div>
        )}
        {estimate.status === "DECLINED" && (
          <p className="text-sm text-ink-soft">This estimate was declined.</p>
        )}
        {estimate.status === "EXPIRED" && (
          <p className="text-sm text-ink-soft">
            This estimate has expired — contact us if you&apos;d still like to move forward.
          </p>
        )}
        {estimate.status === "CONVERTED" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-medium">This estimate was approved and is being set up.</p>
          </div>
        )}
        {!RESPONDED_STATUSES.has(estimate.status) && (
          <EstimateResponseForm estimateId={estimate.id} allowApproval={!!reviewedQuote}
            expectedQuoteFingerprint={reviewedQuote?.quoteFingerprint}
            deliveryOptions={readOfferedSlots(estimate.deliveryOffer)}
            offerVersion={estimate.deliveryOfferVersion} />
        )}
      </div>
    </main>
  );
}
