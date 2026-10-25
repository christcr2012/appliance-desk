import { SigningBusinessReviewForm } from "./signing-business-review-form";
import { SendTextPanel } from "@/app/desk/_text/send-text-panel";
import { AgreementProgress } from "@/components/desk/agreement-progress";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAgreement } from "./operational-agreement";
import Link from "next/link";
import { getAgreementById } from "@/domains/agreements";
import { getAppliances } from "@/domains/inventory";
import { AgreementDetailPanel } from "./agreement-detail-panel";
import { MonthToMonthEndForm } from "./month-to-month-end-form";
import { getMonthToMonthEndQuote } from "@/domains/agreements/month-to-month";
import { billingPeriodFor } from "@/lib/business-date";
import { latestArtifactId } from "@/domains/documents/artifacts";
import { listPackagesForLines } from "@/domains/packages";
import { getDraftSigningChargePreview } from "@/domains/billing/signing-charge-preview";
import { formatMoney } from "@/lib/money-ui";
import { getPreparedSigningChargeReview } from "@/domains/billing/signing-charge-review";
import { SigningChargePrepareForm } from "./signing-charge-prepare-form";
import { SetupFeeOverrideForm } from "./setup-fee-override-form";
import { assessPreparedSigningCharges } from "@/domains/billing/signing-charge-readiness";
import { getDraftSigningTaxReview } from "@/domains/billing/signing-charge-tax-review";
import { prisma } from "@/lib/prisma";
import { ManualSigningPaymentForm } from "./manual-signing-payment-form";
import { customerSigningSummary } from "@/domains/portal/signing-status";
import { SigningPaymentSummary } from "@/components/billing/signing-payment-summary";
import { signingPaymentRecoveryAdvice } from "@/domains/billing/signing-payment-recovery";
import { getReviewedSigningOrderReadback } from "@/domains/billing/signing-order-readback";
import { ReviewedSigningOrder } from "@/components/billing/reviewed-signing-order";
import { PickupVisitPanel } from "./pickup-visit-panel";
import { AgreementDeliveryOfferPanel } from "./delivery-offer-panel";
import { DeliveryRouteReview } from "@/components/locations/delivery-route-review";
import { readOfferedSlots } from "@/domains/orders/delivery";
import { RecordConnections } from "@/components/desk/record-connections";

export const metadata = { title: "Agreement" };

export default async function AgreementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAgreement id={id} />;
  const [agreement, availableAppliances, packages] = await Promise.all([
    getAgreementById(id),
    getAppliances({ status: "AVAILABLE" }),
    listPackagesForLines(),
  ]);

  if (!agreement) {
    notFound();
  }

  const signingPayment = await prisma.agreementSigningPayment.findUnique({
    where: { agreementId: agreement.id },
    include: { receipt: true,
      attempts: { orderBy: { attemptNumber: "desc" }, take: 1 } },
  });
  const verifiedSigningSummary = signingPayment
    ? customerSigningSummary(signingPayment, agreement.customer.id)
    : null;
  const recovery = signingPayment ? signingPaymentRecoveryAdvice({
    obligationStatus: signingPayment.status,
    totalCents: signingPayment.totalCents,
    receiptVerified: verifiedSigningSummary?.status === "RECEIVED",
    fingerprint: signingPayment.orderFingerprint,
    latestAttempt: signingPayment.attempts[0] ?? null,
  }) : null;
  const cancellation = await prisma.preDeliveryCancellation.findUnique({where:{agreementId:agreement.id}});
  const todayParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const localDay = ["year", "month", "day"]
    .map((type) => todayParts.find((part) => part.type === type)?.value ?? "")
    .join("-");

  const [endQuote, signedArtifactId, signingPreview, preparedCharges, taxReview] = await Promise.all([
    agreement.status === "ACTIVE" && agreement.termMonths === null ? getMonthToMonthEndQuote(agreement.id) : null,
    agreement.signature?.signedAt ? latestArtifactId("SIGNED_AGREEMENT", agreement.id) : null,
    agreement.status === "DRAFT" ? getDraftSigningChargePreview(agreement.id) : null,
    agreement.status === "DRAFT" ? getPreparedSigningChargeReview(agreement.id) : [],
    agreement.status === "DRAFT" ? getDraftSigningTaxReview(agreement.id) : null,
  ]);
  const hasFrozenSigningOffer = Boolean(agreement.signature?.signingOrderFingerprint ||
    preparedCharges.some(row => row.frozenAt));
  const frozenOrder = hasFrozenSigningOffer
    ? await getReviewedSigningOrderReadback(agreement.id).catch(() => null)
    : null;
  const businessReview = frozenOrder?.evidenceVersion === 2
    ? await prisma.signingBusinessReview.findFirst({where:{agreementId:agreement.id,orderFingerprint:frozenOrder.orderFingerprint,effectiveFromKey:{lte:localDay},recordedAt:{lte:new Date()}},orderBy:{revision:"desc"},select:{decision:true,revision:true}}) : null;
  const locationLabels = signingPreview
    ? new Map((await prisma.serviceAddress.findMany({
      where: { id: { in: signingPreview.locations.map(row => row.serviceAddressId) } },
      select: { id: true, line1: true, city: true },
    })).map(row => [row.id, row.line1 + ", " + row.city]))
    : new Map<string, string>();
  const readiness = preparedCharges.length > 0
    ? assessPreparedSigningCharges(preparedCharges.map((row) => row.agreementId), preparedCharges)
    : null;
  const earlierOptions: Date[] = [];
  if (endQuote && agreement.nextBillingDate) {
    for (let k = 0; k < 600; k += 1) {
      const start = billingPeriodFor(agreement.nextBillingDate, k).start;
      if (start >= endQuote.effectiveOn) break;
      earlierOptions.push(start);
    }
  }

  const appointmentOffer = await prisma.rentalAgreement.findUnique({
    where:{id},select:{deliveryOffer:true,deliveryOfferVersion:true,status:true},
  });
  return (
    <div className="max-w-3xl">
      <Link
        href="/desk/agreements"
        className="text-sm text-ink-soft hover:underline"
      >
        &larr; Back to agreements
      </Link>

      <div className="mt-3">
        <SendTextPanel userId={session.user.id} entityType="RentalAgreement" entityId={agreement.id} path={`/desk/agreements/${agreement.id}`}
          families={["signature_request", "signature_reminder", "signature_received", "renewal_heads_up"]}
          principal={{ customerId: agreement.customer.id }} />
      </div>

      <h1 className="mt-2 text-xl font-semibold">
        Agreement for{" "}
        <Link
          href={`/desk/customers/${agreement.customer.id}`}
          className="hover:underline"
        >
          {agreement.customer.user.name ?? agreement.customer.user.email}
        </Link>
      </h1>
      <p className="mt-1 text-sm text-ink-soft">
        {agreement.serviceAddress.line1}, {agreement.serviceAddress.city},{" "}
        {agreement.serviceAddress.state} {agreement.serviceAddress.zip}
      </p>
      {cancellation && <section className="mt-3 rounded-lg border p-4" role="status"><h2 className="font-semibold">Cancellation review</h2><p>Approved refund due: {formatMoney(cancellation.refundDueCents)}. Status: {cancellation.refundState === "PENDING_EXTERNAL_REFUND" ? "Not yet paid — separate money-out approval required" : cancellation.refundState === "NOT_REQUIRED" ? "No signing refund due" : cancellation.refundState === "RETURNED_STRIPE_TEST_VERIFIED" ? "Stripe TEST return verified" : "Manual return recorded"}.</p><p>Retained: {formatMoney(cancellation.retainedCents)}. Approved reason: {cancellation.reason}</p></section>}
      {cancellation?.refundState === "PENDING_EXTERNAL_REFUND" && <Link href={`/desk/agreements/${agreement.id}/refund`} className="text-primary underline">Reconcile returned refund</Link>}
      {signedArtifactId && (
        <p className="mt-3 text-sm">
          <Link className="font-medium text-primary underline" href={`/api/documents/${signedArtifactId}`} target="_blank">
            View frozen signed agreement record
          </Link>
          <span className="ml-2 text-ink-soft">This is the exact stored evidence from signing.</span>
        </p>
      )}

      {hasFrozenSigningOffer && !frozenOrder && (
        <p role="status" className="mt-4 rounded-lg border border-line p-3 text-sm">
          Frozen signing order could not be verified. Review the agreement records before using a displayed amount.
        </p>
      )}
      {frozenOrder && <ReviewedSigningOrder order={frozenOrder} />}
      {frozenOrder?.evidenceVersion === 2 && <SigningBusinessReviewForm agreementId={agreement.id}
        fingerprint={frozenOrder.orderFingerprint} day={localDay} editable={session.user.role === "OWNER"} canReopen={agreement.status === "DRAFT"}
        current={businessReview ? `Recorded revision ${businessReview.revision}: ${businessReview.decision === "APPROVED" ? "advice received" : "review required"}` : "Review required — no owner clearance is recorded."} />}
      {signingPreview && (
        <section aria-labelledby="signing-preview-heading" className="mt-6 rounded-lg border border-border p-4">
          <h2 id="signing-preview-heading" className="font-semibold">Signing charges — planning preview</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Estimated mandatory signing amounts for this draft order. This is not a bill,
            a payment request, or a signed contract. First month&apos;s rent begins at delivery,
            except that a large-order down payment will credit that first bill.
          </p>
          <dl className="mt-3 space-y-1 text-sm">
            <div className="flex justify-between"><dt>Administrative setup fees</dt><dd>{formatMoney(signingPreview.setupTotalCents)}</dd></div>
            <div className="flex justify-between"><dt>Large-order down payment</dt><dd>{formatMoney(signingPreview.downPaymentTotalCents)}</dd></div>
            <div className="flex justify-between font-semibold"><dt>Before any applicable tax</dt><dd>{formatMoney(signingPreview.amountDueAtSigningCents)}</dd></div>
          </dl>
          {session.user.role === "OWNER" && (
            <div className="mt-4 space-y-3">
              <h3 className="text-sm font-semibold">Owner-approved location fee waivers and overrides</h3>
              {signingPreview.locations.map(location => (
                <div key={location.serviceAddressId} className="space-y-2">
                  <p className="text-sm font-medium">
                    {locationLabels.get(location.serviceAddressId) ?? location.serviceAddressId}
                    {" · "}Current fee: {formatMoney(location.setupFeeCents)}
                  </p>
                  <SetupFeeOverrideForm agreementId={agreement.id}
                    addressId={location.serviceAddressId}
                    currentCents={location.setupFeeCents}
                    existingReason={location.feeOverrideReason} />
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-sm text-ink-soft">
            {signingPreview.locations.length} delivery location(s); {signingPreview.machineCount} machine(s).
            {signingPreview.requiresTaxReview
              ? " Setup-fee tax treatment needs CPA confirmation before this total can be finalized."
              : " Tax and full customer-facing totals will be finalized in the signing workflow."}
          </p>
        </section>
      )}
      {agreement.status === "DRAFT" && (
        <section aria-labelledby="prepared-charges-heading" className="mt-6 rounded-lg border border-border p-4">
          <h2 id="prepared-charges-heading" className="font-semibold">
            Prepare this order for signing
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            Save a private version of the draft setup fees and first-month
            down-payment amounts for each rental agreement. You can refresh
            it after changing an unsent draft. This does not send a contract,
            book a delivery, collect money, or issue a first-bill credit.
          </p>
          <SigningChargePrepareForm agreementId={agreement.id} />
          {readiness && (
            <div className="mt-3 rounded-md border border-border p-3" role="status">
              <p className="text-sm font-medium">Pre-signing reconciliation</p>
              <p className="mt-1 text-sm">
                {readiness.amountsReconciled
                  ? "Draft allocations reconcile across this order."
                  : "Draft allocations need correction before they can be finalized."}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {readiness.machineCount} machine(s) · Setup: {formatMoney(readiness.totalSetupCents)} ·
                Down payment: {formatMoney(readiness.totalDownPaymentCents)} ·
                Pre-tax subtotal: {formatMoney(readiness.totalBeforeTaxCents)}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
                {readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
              <p className="mt-2 text-sm font-medium">
                Not approved for signing, freezing, charging or sending to customers.
              </p>
            </div>
          )}
          {taxReview && preparedCharges.length > 0 && (
            <div className="mt-3 rounded-md border border-border p-3">
              <h3 className="text-sm font-semibold">Setup tax — private working figures</h3>
              <p className="mt-1 text-sm text-ink-soft">
                {taxReview.orderReady
                  ? "Tax candidates calculated for owner review only."
                  : "Tax candidates cannot be finalized until the items below are resolved."}
                {" "}These are not signed, payable or customer-approved totals.
              </p>
              {taxReview.orderDraft?.totals && <p className="mt-3 font-semibold">All properties — private draft setup, tax and down payment total: {formatMoney(taxReview.orderDraft.totals.allInCandidateCents)}. Not signed or payable.</p>}
              {taxReview.rows.map((row) => (
                <div key={row.agreementId} className="mt-2 border-t border-border pt-2 text-sm">
                  <p className="font-medium">Agreement {row.agreementId} — draft version {row.version}</p>
                  {row.review.status === "CALCULATED_DRAFT" ? (
                    <p className="text-ink-soft">
                      Candidate setup tax: {formatMoney(row.review.setupTaxCents ?? 0)};
                      candidate signing total: {formatMoney(row.review.candidateSigningTotalCents ?? 0)}.
                      Not an invoice or collection authorization.
                    </p>
                  ) : (
                    <ul className="list-disc pl-5 text-ink-soft">
                      {row.review.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  )}
                </div>
              ))}
              {taxReview.reasons.length > 0 && <p className="mt-2 text-sm text-ink-soft">
                {taxReview.reasons.length} outstanding item(s) prevent an order-wide candidate total.
              </p>}
            </div>
          )}
          {preparedCharges.length > 0 ? (
            <div className="mt-4 space-y-3">
              <p className="text-sm font-medium">
                Prepared records — verify every location before any customer-facing quote
              </p>
              {preparedCharges.map((charge) => (
                <div key={charge.id} className="rounded-md border border-border p-3">
                  <p className="font-medium">
                    {charge.agreement.serviceAddress.line1},{" "}
                    {charge.agreement.serviceAddress.city},{" "}
                    {charge.agreement.serviceAddress.state}{" "}
                    {charge.agreement.serviceAddress.zip}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {charge.machineCount} machine(s) · Draft revision {charge.version}
                  </p>
                  <dl className="mt-2 space-y-1 text-sm">
                    <div className="flex justify-between gap-3">
                      <dt>Setup fee allocated here</dt><dd>{formatMoney(charge.setupFeeCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt>Down payment for this agreement</dt><dd>{formatMoney(charge.downPaymentCents)}</dd>
                    </div>
                    <div className="flex justify-between gap-3 font-semibold">
                      <dt>Draft subtotal before tax</dt><dd>{formatMoney(charge.signingSubtotalCents)}</dd>
                    </div>
                  </dl>
                  <p className="mt-1 text-xs text-ink-soft">
                    {charge.setupFeeTaxTreatment === "UNDECIDED"
                      ? "Setup-fee tax treatment awaits CPA confirmation; do not send or charge this total."
                      : "Prepared amounts are not a tax-inclusive final signing total or proof of payment."}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-soft">
              No complete order-wide preparation is on record yet.
            </p>
          )}
        </section>
      )}
      {signingPayment && (
        <section aria-labelledby="signing-manual-heading" className="mt-6 rounded-lg border border-line p-4">
          <h2 id="signing-manual-heading" className="text-lg font-semibold">Signing payment</h2>
          <SigningPaymentSummary summary={verifiedSigningSummary} />
          {verifiedSigningSummary?.status === "RECEIVED" && signingPayment.receipt && (
            <p className="mt-2 text-sm">
              Receipt {signingPayment.receipt.id} · {signingPayment.receipt.method} ·
              recorded {signingPayment.receipt.receivedOn.toLocaleDateString("en-US", { timeZone: "America/Denver" })}.
              Money received for signing is distinct from money paid on the first invoice.
            </p>
          )}
          {signingPayment.status === "AWAITING_PAYMENT" &&
            signingPayment.attempts[0]?.status === "FAILED" && (
              <p className="mt-2 text-sm text-danger" role="alert">
                The latest signing collection attempt failed. Verify the provider
                outcome before starting another payment. The signed amount is
                still due, and a failed attempt is not a receipt.
              </p>
            )}
          {signingPayment.status === "AWAITING_PAYMENT" &&
            signingPayment.attempts[0]?.status !== "FAILED" &&
            signingPayment.attempts[0]?.method === "STRIPE_CHECKOUT" && (
              <p className="mt-2 text-sm" role="status">
                A card payment is already prepared or pending. Investigate its actual
                outcome before attempting manual collection; no duplicate receipt is allowed.
              </p>
            )}
          {recovery && (
            <div className="mt-3 rounded-lg border border-line bg-subtle p-3 text-sm" role="status">
              <h3 className="font-semibold">{recovery.heading}</h3>
              <p className="mt-1 text-ink-soft">{recovery.explanation}</p>
              {recovery.providerReconciliationRequired && (
                <p className="mt-2 font-medium">
                  Reconcile the provider outcome and signed agreement evidence before retrying or dispatch.
                </p>
              )}
            </div>
          )}
          {recovery?.canRecordManual && (
              <ManualSigningPaymentForm agreementId={agreement.id}
                amountCents={signingPayment.totalCents} receivedOn={localDay} />
            )}
        </section>
      )}
      <div className="mt-6">
        <AgreementProgress agreement={agreement} />
      </div>
      <PickupVisitPanel agreementId={agreement.id} />
      <div className="mt-6">
        {appointmentOffer&&<DeliveryRouteReview kind="agreement" id={id}
          origin={(await prisma.businessSettings.findUnique({
            where:{id:"singleton"},select:{drivingOriginAddress:true},
          }))?.drivingOriginAddress??"UNVERIFIED"}
          verified={!!(await prisma.businessSettings.findUnique({
            where:{id:"singleton"},select:{drivingOriginVerifiedAt:true},
          }))?.drivingOriginVerifiedAt}
          proofExists={!!(await prisma.rentalAgreement.findUnique({
            where:{id},select:{deliveryRouteProof:true},
          }))?.deliveryRouteProof} feeCents={null}/>}
        {appointmentOffer&&<AgreementDeliveryOfferPanel agreementId={id}
          initial={readOfferedSlots(appointmentOffer.deliveryOffer)}
          version={appointmentOffer.deliveryOfferVersion}
          editable={["DRAFT","AWAITING_SIGNATURE"].includes(appointmentOffer.status)}/>}
        <AgreementDetailPanel
          agreement={agreement}
          packages={packages}
          availableAppliances={availableAppliances.map((a) => ({
            id: a.id,
            assetNumber: a.assetNumber,
            typeName: a.applianceType.name,
          }))}
        />
      </div>
      {agreement.status === "ACTIVE" && (
        <p className="mt-6 text-sm text-ink-soft">
          Did all of the equipment come back early?{" "}
          <Link href={`/desk/agreements/${agreement.id}/early-return`} className="font-medium text-primary underline">
            Choose what happens to billing, refunds and fees
          </Link>
          .
        </p>
      )}
      {endQuote && (
        <MonthToMonthEndForm
          agreementId={agreement.id}
          noticeDays={endQuote.noticeDays}
          effectiveOn={endQuote.effectiveOn}
          earlierOptions={earlierOptions}
        />
      )}
      <RecordConnections kind="agreement" id={id} />
    </div>
  );
}