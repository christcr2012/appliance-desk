import { SigningBusinessReviewForm } from "./signing-business-review-form";
import { SendTextPanel } from "@/app/desk/_text/send-text-panel";
import { requireRole } from "@/lib/session";
import { notFound } from "next/navigation";
import { OperationalAgreement } from "./operational-agreement";
import Link from "next/link";
import { getAgreementById } from "@/domains/agreements";
import { getAppliances } from "@/domains/inventory";
import { AgreementDetailPanel } from "./agreement-detail-panel";
import { MonthToMonthEndForm } from "./month-to-month-end-form";
import { getMonthToMonthEndQuote } from "@/domains/agreements/month-to-month";
import { billingPeriodFor, formatShortDate } from "@/lib/business-date";
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
import {
  ActionBar,
  InfoTip,
  NextStepCard,
  RecordHeader,
  StatStrip,
  StatusPill,
  Stepper,
  Timeline,
  Toaster,
  recordBarActions,
  type ActionSpec,
  type MenuItem,
  type StatItem,
  type StepperStep,
  type TimelineItem,
} from "@/components/kit";
import { AGREEMENT_PILL } from "@/domains/customers/record";
import { agreementProgress } from "@/domains/agreements/progress";
import { rentalNextStep } from "@/domains/agreements/next-step";
import { endOptions } from "@/domains/agreements/end-options";
import { getRentalTimeline } from "@/domains/agreements/timeline";
import { getRentalEndReasons } from "@/domains/agreements/end-reasons";
import { listRentalEndingSoon } from "@/domains/exceptions/turning-points-attention";
import { loadReturnPickup } from "@/domains/agreements/early-return";
import { isReservationStale } from "@/domains/agreements/reservation-status";
import { jobStatusLabel, jobTypeLabel } from "@/lib/status-labels";
import {
  extendReservationFormAction,
  sendForSignatureFormAction,
  setEndReasonAction,
} from "../actions";
import { EndReasonFields } from "./end-reason-fields";
import { RentalRecordClient } from "./record-client";

export const metadata = { title: "Rental" };

const JOB_PILL_TONE: Record<string, "good" | "info" | "neutral" | "attention"> = {
  COMPLETED: "good",
  SCHEDULED: "info",
  IN_PROGRESS: "info",
  CANCELLED: "neutral",
};

export default async function AgreementDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; end?: string; text?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const { id } = await params;
  if (session.user.role === "STAFF") return <OperationalAgreement id={id} />;
  const query = await searchParams;
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
  const now = new Date();

  const [
    endQuote, signedArtifactId, signingPreview, preparedCharges, taxReview,
    routeSettings, routeProof, endReasons, endingSoonRows, returnPickup,
    timeline,
  ] = await Promise.all([
    agreement.status === "ACTIVE" && agreement.termMonths === null ? getMonthToMonthEndQuote(agreement.id) : null,
    agreement.signature?.signedAt ? latestArtifactId("SIGNED_AGREEMENT", agreement.id) : null,
    agreement.status === "DRAFT" ? getDraftSigningChargePreview(agreement.id) : null,
    agreement.status === "DRAFT" ? getPreparedSigningChargeReview(agreement.id) : [],
    agreement.status === "DRAFT" ? getDraftSigningTaxReview(agreement.id) : null,
    prisma.businessSettings.findUnique({
      where: { id: "singleton" },
      select: { drivingOriginAddress: true, drivingOriginVerifiedAt: true },
    }),
    prisma.rentalAgreement.findUnique({
      where: { id }, select: { deliveryRouteProof: true },
    }),
    getRentalEndReasons(),
    listRentalEndingSoon(50, now),
    loadReturnPickup(prisma, agreement.id),
    getRentalTimeline(agreement.id),
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

  // --- AR-4a record composition (RENTALS spec section 3) ---
  const customerName = agreement.customer.user.name ?? agreement.customer.user.email;
  const pill = AGREEMENT_PILL[agreement.status](agreement.startDate, now);
  const monthlyCents = agreement.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0);
  const billingStat: StatItem = agreement.billingBlockedReason
    ? { label: "Billing", value: "Not running", tone: "attention" }
    : agreement.billingStartedAt
      ? { label: "Billing", value: agreement.nextBillingDate ? `Next bill ${formatShortDate(agreement.nextBillingDate, now)}` : "Running" }
      : agreement.paidInFullInAdvance
        ? { label: "Billing", value: "Paid in advance" }
        : { label: "Billing", value: "Not started" };
  const stats: StatItem[] = [
    { label: "Monthly rent", value: formatMoney(monthlyCents) },
    {
      label: "Term",
      value: agreement.termMonths
        ? `${agreement.termMonths} months${agreement.endDate ? ` · ends ${formatShortDate(agreement.endDate, now)}` : ""}`
        : "Month to month",
    },
    { label: "Deposit", value: agreement.depositCents > 0 ? formatMoney(agreement.depositCents) : "None" },
    billingStat,
  ];

  const progress = agreementProgress(agreement);
  const assignmentCount = agreement.lines.reduce((sum, l) => sum + l.assignments.length, 0);
  const delivered = agreement.jobs.some(
    (j) => (j.type === "DELIVERY" || j.type === "INSTALLATION") && j.status === "COMPLETED",
  );
  const deliveryScheduled = agreement.jobs.some(
    (j) => (j.type === "DELIVERY" || j.type === "INSTALLATION") && (j.status === "SCHEDULED" || j.status === "IN_PROGRESS"),
  );
  const steps: StepperStep[] = [
    {
      label: "Signed",
      state: agreement.signature?.signedAt ? "done" : agreement.status === "AWAITING_SIGNATURE" ? "current" : "waiting",
      detail: progress.milestones[0]?.state,
    },
    {
      label: "Appliances",
      state: assignmentCount > 0 ? "done" : agreement.signature?.signedAt ? "current" : "waiting",
      detail: progress.milestones[2]?.state,
    },
    {
      label: "Delivered",
      state: delivered ? "done" : deliveryScheduled ? "current" : "waiting",
      detail: progress.milestones[3]?.state,
    },
    {
      label: "Billing",
      state: agreement.billingBlockedReason
        ? "problem"
        : agreement.billingStartedAt || agreement.paidInFullInAdvance
          ? "done"
          : delivered
            ? "current"
            : "waiting",
      detail: progress.milestones[4]?.state,
    },
  ];

  const endingSoon = endingSoonRows.rows.some(
    (row) => row.href === `/desk/agreements/${id}/ending-decision`,
  );
  const nextStep = rentalNextStep({
    agreement: {
      id: agreement.id,
      status: agreement.status,
      startDate: agreement.startDate,
      endDate: agreement.endDate,
      termMonths: agreement.termMonths,
      depositCents: agreement.depositCents,
      paidInFullInAdvance: agreement.paidInFullInAdvance,
      billingStartedAt: agreement.billingStartedAt,
      billingBlockedReason: agreement.billingBlockedReason,
      signature: agreement.signature ? { signedAt: agreement.signature.signedAt } : null,
      lines: agreement.lines,
      jobs: agreement.jobs,
    },
    cancellation: cancellation
      ? { refundDueCents: cancellation.refundDueCents, refundState: cancellation.refundState }
      : null,
    endingSoon,
    now,
  });
  const nextStepActions: ActionSpec[] = nextStep?.action
    ? [
        nextStep.action.kind === "link"
          ? { kind: "link", label: nextStep.action.label, href: nextStep.action.href }
          : nextStep.action.kind === "send-for-signature"
            ? { kind: "form", label: nextStep.action.label, action: sendForSignatureFormAction, fields: { agreementId: id } }
            : nextStep.action.kind === "reminder"
              ? { kind: "link", label: nextStep.action.label, href: `/desk/agreements/${id}?text=1` }
              : { kind: "link", label: nextStep.action.label, href: `/desk/agreements/${id}?end=1` },
      ]
    : [];

  const signedNotDelivered = Boolean(agreement.signature?.signedAt) && !delivered &&
    agreement.status !== "ENDED" && agreement.status !== "CANCELLED";
  const scheduledVisit = agreement.jobs.find(
    (j) => (j.type === "DELIVERY" || j.type === "INSTALLATION") && (j.status === "SCHEDULED" || j.status === "IN_PROGRESS"),
  );
  const primary: ActionSpec | undefined =
    agreement.status === "DRAFT"
      ? { kind: "link", label: "Resume rental builder", href: `/desk/agreements/new?draftId=${id}` }
      : agreement.status === "AWAITING_SIGNATURE"
        ? { kind: "link", label: "Send a reminder…", href: `/desk/agreements/${id}?text=1` }
        : signedNotDelivered
          ? scheduledVisit
            ? { kind: "link", label: "Open the visit", href: `/desk/jobs/${scheduledVisit.id}` }
            : { kind: "link", label: "Schedule delivery", href: `/desk/jobs/new?agreementId=${id}` }
          : agreement.status === "ACTIVE"
            ? { kind: "link", label: "End this rental…", href: `/desk/agreements/${id}?end=1` }
            : undefined;

  const endOpts = endOptions({
    agreement: {
      id: agreement.id,
      status: agreement.status,
      termMonths: agreement.termMonths,
      endDate: agreement.endDate,
      terminationRequestedAt: agreement.terminationRequestedAt,
      firstDeliveredOn: agreement.firstDeliveredOn,
      customerName,
    },
    monthToMonthEndAvailable: Boolean(endQuote),
    returnPickupFound: Boolean(returnPickup),
  });

  const stale = isReservationStale(agreement.status, agreement.reservationExpiresAt, now);
  const overflow: MenuItem[] = [
    { kind: "link", label: "Send a text…", href: `/desk/agreements/${id}?text=1` },
    { kind: "link", label: "View customer", href: `/desk/customers/${agreement.customer.id}` },
    { kind: "link", label: "View statement", href: `/desk/billing/customer/${agreement.customer.id}` },
    ...(signedArtifactId
      ? [{ kind: "link", label: "Signed rental agreement", href: `/api/documents/${signedArtifactId}` } as MenuItem]
      : []),
    ...(stale && (agreement.status === "DRAFT" || agreement.status === "AWAITING_SIGNATURE")
      ? [{ kind: "form", label: "Extend the hold", action: extendReservationFormAction, fields: { agreementId: id } } as MenuItem]
      : []),
    ...(agreement.status === "ACTIVE"
      ? [{ kind: "link", label: "Schedule a visit", href: `/desk/jobs/new?agreementId=${id}` } as MenuItem]
      : []),
    // Cancellation (and every other ending) stays reachable for rentals
    // that are not active yet: the End sheet offers cancel-before-delivery
    // for drafts, waiting-for-signature and signed-not-delivered rentals
    // (Codex review, PR #722). ACTIVE rentals already carry it as primary.
    ...(endOpts.length > 0 && agreement.status !== "ACTIVE"
      ? [{ kind: "link", label: "End this rental…", href: `/desk/agreements/${id}?end=1` } as MenuItem]
      : []),
  ];

  const showSigning = agreement.status === "DRAFT" || agreement.status === "AWAITING_SIGNATURE" ||
    Boolean(signingPayment) || hasFrozenSigningOffer || Boolean(signedArtifactId);
  const requestedTab = query.tab ?? "details";
  const tab = requestedTab === "signing" && showSigning
    ? "signing"
    : requestedTab === "visits"
      ? "visits"
      : requestedTab === "activity"
        ? "activity"
        : "details";
  const mainTab = tab === "activity" ? "details" : tab;
  const tabHref = (value: string) => `/desk/agreements/${id}?tab=${value}`;
  const tabClass = (active: boolean) =>
    `inline-flex min-h-11 items-center rounded-field px-3 text-sm font-semibold ${
      active ? "bg-tint text-ink" : "text-ink-soft hover:bg-tint hover:text-ink"
    }`;

  const timelineItems: TimelineItem[] = timeline.map((item) => ({
    id: item.id,
    at: item.at,
    title: item.title,
    actor: item.actor,
    tone: "neutral",
  }));
  const activityBlock = (
    <>
      <h2 className="text-base font-bold text-ink">Activity</h2>
      <div className="mt-2">
        <Timeline items={timelineItems} emptyLabel="Nothing has happened on this rental yet." now={now} />
      </div>
      <div className="mt-6">
        <RecordConnections kind="agreement" id={id} />
      </div>
    </>
  );

  const monthToMonthForm = endQuote ? (
    <MonthToMonthEndForm
      agreementId={agreement.id}
      noticeDays={endQuote.noticeDays}
      effectiveOn={endQuote.effectiveOn}
      earlierOptions={earlierOptions}
      endReasons={endReasons}
    />
  ) : null;
  const textPanel = (
    <SendTextPanel userId={session.user.id} entityType="RentalAgreement" entityId={agreement.id} path={`/desk/agreements/${agreement.id}`}
      families={["signature_request", "signature_reminder", "signature_received", "renewal_heads_up"]}
      principal={{ customerId: agreement.customer.id }} />
  );

  return (
    <>
    <Toaster />
    <RentalRecordClient
      agreementId={id}
      endOptions={endOpts}
      endReasons={endReasons}
      initialEndOpen={query.end === "1"}
      initialTextOpen={query.text === "1"}
      monthToMonthForm={monthToMonthForm}
      textPanel={textPanel}
    >
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-6">
        <div className="min-w-0 max-w-3xl">
          <RecordHeader
            title={customerName}
            transitionId={agreement.id}
            pills={[pill]}
            subtitle={`${agreement.serviceAddress.line1}, ${agreement.serviceAddress.city}`}
            contact={{ phone: agreement.customer.phone ?? undefined, email: agreement.customer.user.email }}
            primary={primary}
            overflow={overflow}
            back={{ href: "/desk/agreements", label: "Rentals" }}
          />
          <StatStrip items={stats} />
          <section aria-label="Progress" className="mt-4 rounded-card border border-line bg-surface px-4 py-3.5">
            <Stepper steps={steps} label="Rental progress" />
          </section>
          {nextStep && nextStepActions.length > 0 ? (
            <div className="mt-4">
              <NextStepCard title={nextStep.title} actions={nextStepActions} />
              {nextStep.infoTip ? <p className="mt-1 px-1 text-sm text-ink-soft">{nextStep.infoTip}</p> : null}
            </div>
          ) : nextStep ? (
            <section aria-label="Next step" className="mt-4 rounded-card border border-line bg-surface px-4 py-3.5">
              <p className="text-xs font-bold text-ink-soft">Next step</p>
              <p className="mt-1 text-base font-bold text-ink">{nextStep.title}</p>
              {nextStep.infoTip ? <p className="mt-1 text-sm text-ink-soft">{nextStep.infoTip}</p> : null}
            </section>
          ) : null}

          <nav aria-label="Rental sections" className="mt-6 flex flex-wrap gap-1 border-b border-line pb-2">
            <Link href={tabHref("details")} className={tabClass(mainTab === "details")} aria-current={mainTab === "details" ? "page" : undefined}>
              Details
            </Link>
            {showSigning && (
              <Link href={tabHref("signing")} className={tabClass(mainTab === "signing")} aria-current={mainTab === "signing" ? "page" : undefined}>
                Signing
              </Link>
            )}
            <Link href={tabHref("visits")} className={tabClass(mainTab === "visits")} aria-current={mainTab === "visits" ? "page" : undefined}>
              Visits
            </Link>
            <Link href={tabHref("activity")} className={`${tabClass(tab === "activity")} lg:hidden`} aria-current={tab === "activity" ? "page" : undefined}>
              Activity
            </Link>
          </nav>

          {mainTab === "details" && (
            <div className="mt-6">
              <AgreementDetailPanel
                agreement={agreement}
                packages={packages}
                hideActions
                availableAppliances={availableAppliances.map((a) => ({
                  id: a.id,
                  assetNumber: a.assetNumber,
                  typeName: a.applianceType.name,
                }))}
              />
              {(agreement.status === "ENDED" || agreement.status === "CANCELLED" || agreement.endReason) && (
                <form action={setEndReasonAction} className="mt-6 rounded-lg border border-line bg-white p-5">
                  <h2 className="font-medium text-ink">Why it ended</h2>
                  <input type="hidden" name="agreementId" value={agreement.id} />
                  <div className="[&_fieldset]:mt-2">
                    <EndReasonFields reasons={endReasons} />
                  </div>
                  {agreement.endReason && (
                    <p className="mt-2 text-sm text-ink-soft">
                      Recorded: {agreement.endReason}
                      {agreement.endReasonNote ? ` — ${agreement.endReasonNote}` : ""}
                    </p>
                  )}
                  <button type="submit" className="mt-3 min-h-11 rounded-lg border border-control px-4 py-2 text-sm font-medium text-primary hover:bg-subtle">
                    Save the reason
                  </button>
                </form>
              )}
              {agreement.status === "ACTIVE" && (
                <p className="mt-6 text-sm text-ink-soft">
                  Did all of the equipment come back early?{" "}
                  <Link href={`/desk/agreements/${agreement.id}/early-return`} className="font-medium text-primary underline">
                    Choose what happens to billing, refunds and fees
                  </Link>
                  .
                </p>
              )}
            </div>
          )}

          {mainTab === "signing" && (
            <div className="mt-6">
              {hasFrozenSigningOffer && !frozenOrder && (
                <p role="status" className="rounded-lg border border-line p-3 text-sm">
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
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-soft">
                    Estimated mandatory signing amounts for this draft order. <InfoTip term="signing-preview" />
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
                  <p className="mt-1 flex items-center gap-1 text-sm text-ink-soft">
                    Private draft amounts for each agreement in this order. <InfoTip term="signing-prepare" />
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
                      <h3 className="flex items-center gap-1 text-sm font-semibold">Setup tax — private working figures <InfoTip term="signing-tax-review" /></h3>
                      <p className="mt-1 text-sm text-ink-soft">
                        {taxReview.orderReady
                          ? "Tax candidates calculated for owner review only."
                          : "Tax candidates cannot be finalized until the items below are resolved."}
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
            </div>
          )}

          {mainTab === "visits" && (
            <div className="mt-6 space-y-6">
              {appointmentOffer && (
                <>
                  <DeliveryRouteReview kind="agreement" id={id}
                    origin={routeSettings?.drivingOriginAddress ?? "UNVERIFIED"}
                    verified={Boolean(routeSettings?.drivingOriginVerifiedAt)}
                    proofExists={Boolean(routeProof?.deliveryRouteProof)} feeCents={null} />
                  <AgreementDeliveryOfferPanel agreementId={id}
                    initial={readOfferedSlots(appointmentOffer.deliveryOffer)}
                    version={appointmentOffer.deliveryOfferVersion}
                    editable={["DRAFT", "AWAITING_SIGNATURE"].includes(appointmentOffer.status)} />
                </>
              )}
              <PickupVisitPanel agreementId={agreement.id} />
              <section aria-labelledby="visits-heading" className="rounded-lg border border-line bg-white p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 id="visits-heading" className="font-medium text-ink">Visits</h2>
                  {agreement.status === "ACTIVE" && (
                    <Link href={`/desk/jobs/new?agreementId=${agreement.id}`} className="text-sm font-medium text-primary hover:underline">
                      Schedule a visit
                    </Link>
                  )}
                </div>
                {agreement.jobs.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-soft">No visits scheduled yet.</p>
                ) : (
                  <ul className="mt-3 divide-y divide-line">
                    {agreement.jobs.map((job) => (
                      <li key={job.id} className="py-2">
                        <Link href={`/desk/jobs/${job.id}`} className="flex flex-wrap items-center gap-2 text-sm hover:underline">
                          <span className="font-medium text-ink">{jobTypeLabel(job.type)}</span>
                          <span className="text-ink-soft">
                            {job.scheduledAt ? formatShortDate(job.scheduledAt, now) : "Not scheduled"}
                          </span>
                          <StatusPill label={jobStatusLabel(job.status)} tone={JOB_PILL_TONE[job.status] ?? "neutral"} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          )}

          {tab === "activity" && <div className="mt-6 lg:hidden">{activityBlock}</div>}
        </div>
        <aside className="mt-6 hidden min-w-0 lg:mt-0 lg:block">{activityBlock}</aside>
      </div>
      <ActionBar actions={recordBarActions(primary, [])} label="Rental actions" />
    </RentalRecordClient>
    </>
  );
}
