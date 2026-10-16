import { authPageLanguage } from "@/domains/language/auth-page";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { portalLabel } from "@/domains/language/portal-copy";
import { getEstimateForApproval } from "@/domains/estimates";
import { estimateValidThroughKey } from "@/domains/estimates/validity";
import { businessDateFromKey, formatBusinessDate as originalBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing";
import { EstimateResponseForm } from "./estimate-response-form";
import { ContinueEstimateOrderButton } from "./continue-estimate-button";
import { customerOrderFinishStatus } from "@/domains/orders/activation";
import { OrderAccountSetupButton } from "./account-setup-button";
import { PayDepositButton } from "./pay-deposit-button";
import { getFinalizedConvertedEstimateOrder } from "@/domains/estimates/finalized-order";
import { ReviewedSigningOrder } from "@/components/billing/reviewed-signing-order";
import { getPreparedEstimateQuote } from "@/domains/estimates/preapproval-quote";
import { ReviewedPreapprovalQuote } from "@/components/estimates/reviewed-preapproval-quote";
import { readOfferedSlots } from "@/domains/orders/delivery";
import { publicPhoneOrderPrefill } from "@/domains/orders/phone-orders";
import { QuoteLanguageChoice } from "./language-choice";
import { parseCustomerLanguage } from "@/domains/language/copy";
import { displayCustomerLanguage } from "@/domains/language/review";
import { estimateCopy } from "@/domains/language/estimate-copy";

export const metadata = {
  title: "Your estimate",
  robots: { index: false, follow: false },
};

const RESPONDED_STATUSES = new Set(["APPROVED", "CHANGES_REQUESTED", "DECLINED", "EXPIRED", "CONVERTED"]);

export default async function PublicEstimatePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{deposit?:string;signingPayment?:string;language?:string}>;
}) {
  const { id } = await params;
  const payment = await searchParams;
  const estimate = await getEstimateForApproval(id);

  if (!estimate) {
    const language=await authPageLanguage((await searchParams)?.language);
    return (
      <main lang={language} className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">{portalLabel(language,"This link isn't available")}</h1>
        <p className="mt-3 text-ink-soft">
          {portalLabel(language,"This estimate may not have been sent yet, or the link may no longer be valid. If you think this is a mistake, contact us directly.")}
        </p>
      </main>
    );
  }

  const finishedState = estimate.status === "CONVERTED"
    ? await customerOrderFinishStatus(estimate.id) : "WAITING";
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
  const language = await displayCustomerLanguage(parseCustomerLanguage(estimate.preferredLanguage));
  const formatBusinessDate=(date:Date)=>originalBusinessDate(date,language);
  const t = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language,word);
  const tr = (key: Parameters<typeof estimateCopy>[1]) => estimateCopy(language, key);
  const customerName = estimate.customer
    ? (estimate.customer.user.name ?? estimate.customer.user.email)
    : estimate.lead?.contactName;

  return (
    <main lang={language} className="mx-auto max-w-lg px-6 py-16">
      <PaymentReturnNotice language={language} state={payment?.signingPayment ?? payment?.deposit} />
      <h1 className="text-xl font-semibold">{tr("estimate")} #{estimate.estimateNumber}</h1>
      {(estimate.status === "SENT" || estimate.status === "VIEWED") && (
        <QuoteLanguageChoice estimateId={estimate.id}
          preferredLanguage={parseCustomerLanguage(estimate.preferredLanguage)} />
      )}
      <p className="mt-2 text-sm text-ink-soft">{tr("preparedFor")} {customerName}</p>

      {estimate.clientMessage && (
        <p className="mt-4 whitespace-pre-line text-sm text-ink-soft">{estimate.clientMessage}</p>
      )}

      <p className="mt-4 text-sm text-ink-soft" role="note">
        {tr("disclaimer")}
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
                  {line.monthlyPriceCents > 0 && <p>{formatCents(line.monthlyPriceCents)} {tr("recurring")}</p>}
                  {line.oneTimeFeeCents > 0 && <p>{formatCents(line.oneTimeFeeCents)} {tr("oneTime")}</p>}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <div className="border-t border-line pt-3 font-medium text-ink">
          {monthly > 0 && <p>{formatCents(monthly)} {tr("recurring")}</p>}
          {oneTime > 0 && <p>{formatCents(oneTime)} {tr("oneTime")}</p>}
        </div>
        {estimate.depositCents > 0 && <p>{t("Deposit")}: {formatCents(estimate.depositCents)}</p>}
        {estimate.validUntil && (
          <p className="text-xs text-ink-faint">
            {t("Valid through")} {formatBusinessDate(businessDateFromKey(estimateValidThroughKey(estimate.validUntil))!)}
          </p>
        )}
      </div>

      {reviewedQuote && <ReviewedPreapprovalQuote quote={reviewedQuote} language={language} />}
      {(estimate.status === "SENT" || estimate.status === "VIEWED") && !reviewedQuote && (
        <section className="mt-4 rounded border border-amber-400 p-4 text-sm" role="alert">
          {tr("approvalUnavailable")}
        </section>
      )}
      {reviewedOrder?.status === "FINAL_REVIEWED" && (
        <ReviewedSigningOrder order={reviewedOrder.order} context="estimate" language={language} />
      )}
      {estimate.status === "CONVERTED" && reviewedOrder?.status !== "FINAL_REVIEWED" && (
        <section aria-label={tr("finalReviewTitle")} className="mt-5 rounded-lg border border-line bg-subtle p-4 text-sm" role="status">
          <h2 className="font-semibold">{tr("finalReviewTitle")}</h2>
          <p className="mt-1 text-ink-soft">
            {tr("finalReviewBody")}
          </p>
        </section>
      )}
      <div className="mt-6">
        {estimate.status === "APPROVED" && (
          <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
            <p className="font-medium">{tr("approved")}</p>
            <div className="my-3"><ContinueEstimateOrderButton language={language} estimateId={estimate.id}/></div>
            {estimate.depositCents > 0 && estimate.depositPaidAt && (
              <p className="mt-1">
                {t("Deposit received — thank you.")} {formatCents(estimate.depositCents)}
              </p>
            )}
            {reviewedQuote?.evidenceVersion===2 ? (
              <p className="mt-1">{tr("noSeparateDeposit")}</p>
            ) : estimate.depositCents > 0 && !estimate.depositPaidAt ? (
              <>
                <p className="mt-1">
                  {t("A deposit is due before we can move forward.")} {formatCents(estimate.depositCents)}
                </p>
                {reviewedQuote ? <PayDepositButton language={language} estimateId={estimate.id} /> : (
                  <p className="mt-1">{tr("depositDue")}</p>
                )}
              </>
            ) : (
              <p className="mt-1">{tr("nextSteps")}</p>
            )}
          </div>
        )}
        {estimate.status === "CHANGES_REQUESTED" && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
            <p className="font-medium">{tr("requestedChanges")}</p>
            <p className="mt-1">{tr("changesFollowup")}</p>
          </div>
        )}
        {estimate.status === "DECLINED" && (
          <p className="text-sm text-ink-soft">{tr("declined")}</p>
        )}
        {estimate.status === "EXPIRED" && (
          <p className="text-sm text-ink-soft">
            {tr("expired")}
          </p>
        )}
        {estimate.status === "CONVERTED" && (
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 text-sm text-blue-900">
            <p className="font-medium">{tr("finalized")}</p>
            {finishedState === "READY_FOR_ACCOUNT" &&
              <div className="mt-3"><p>{t("Signing payment confirmed. You can create your account password securely.")}</p>
                <OrderAccountSetupButton language={language} estimateId={estimate.id}/></div>}
            {finishedState === "PAYMENT_PENDING" &&
              <p className="mt-2" role="status">{t("Your signature is recorded. Payment is still awaiting verified settlement; a redirect is not a receipt.")}</p>}
            {finishedState === "SIGN" &&
              <div className="mt-3"><ContinueEstimateOrderButton language={language} estimateId={estimate.id}/></div>}
          </div>
        )}
        {!RESPONDED_STATUSES.has(estimate.status) && (
          <EstimateResponseForm language={language} estimateId={estimate.id} allowApproval={!!reviewedQuote}
            expectedQuoteFingerprint={reviewedQuote?.quoteFingerprint}
            deliveryOptions={readOfferedSlots(estimate.deliveryOffer)}
            offerVersion={estimate.deliveryOfferVersion}
            phonePrefill={publicPhoneOrderPrefill(estimate)} />
        )}
      </div>
    </main>
  );
}
