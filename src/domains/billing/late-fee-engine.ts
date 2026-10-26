// FEE-1: fair late fees (docs/build-specs/engines/LATE-FEES.md). Replaces "add the fee to the overdue bill".
//   1. The customer is warned first ("Your payment is late ... a late fee of $X will be added to your next bill on <date>").
//   2. No fee while a payment is in progress (a bank payment being confirmed, a phone payment just started).
//   3. The fee is its own PendingCharge, put on the NEXT bill, never mixed into the bill the customer is paying.
// The decisions are pure functions in late-fee-rules.ts; this file reads the facts, sends the warning, records the charge
// under the bill's row lock, and puts recorded charges on the next bill.
import type Stripe from "stripe";
import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getStripeClient } from "@/lib/stripe";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { deliverMessage } from "@/domains/messaging/deliver";
import { formatCents } from "@/domains/pricing";
import { messageText } from "@/domains/language/transactional-copy";
import { getBusinessSettings } from "@/domains/settings";
import { claimProviderOperation, completeProviderOperation, runProviderCall } from "./provider-ops";
import {
  addDaysToKey, baseFeeDateKey, canJoinNextCharge, decideLateFee, feeDateAfterNoticeKey, lateFeeAmountCents,
  type LateFeeDecision, type LateFeeFacts, LATE_FEE_NOTICE_DAYS_DEFAULT,
} from "./late-fee-rules";

const OPEN_STATUSES = ["OPEN", "PARTIALLY_PAID", "DELINQUENT"] as const;
const BATCH_SIZE = 100;
/** A card or phone payment started this recently counts as "a payment in progress". */
const PHONE_PAYMENT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type LateFeeRunCounts = {
  checked: number;
  noticesSent: number;
  noticesNotSent: number;
  feesRecorded: number;
  needsWarning: number;
  militaryReview: number;
  waitingForPayment: number;
  billedLocal: number;
  sentToStripe: number;
  waitingForNextBill: number;
  stripeBillingOff: number;
  errors: number;
};

export type RecordedLateFee = { invoiceId: string; invoiceNumber: number; customerName: string; feeCents: number };

/** Gate for putting a late fee on a customer's automatic Stripe charge: test keys, or the owner's explicit switch. */
export function lateFeeBillingEnabled(): boolean {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return key.startsWith("sk_test_") || process.env.LATE_FEE_CUSTOMER_CHARGING_ENABLED === "true";
}

type Db = Prisma.TransactionClient | typeof prisma;

export type LoadedFacts = { facts: LateFeeFacts; invoiceNumber: number; customerName: string; baseKey: string; noticeCount: number };

/** Everything the rules need about one overdue bill, read from the database. Pass a transaction to read under the bill's lock. */
export async function loadLateFeeFacts(db: Db, invoiceId: string, now: Date): Promise<LoadedFacts | null> {
  const invoice = await db.invoice.findUnique({
    where: { id: invoiceId },
    select: {
      id: true, invoiceNumber: true, status: true, dueDate: true, amountDueCents: true, amountPaidCents: true, lateFeeCents: true,
      lateNoticeDeliveryId: true, lateNoticeCount: true, lateFeeToldOn: true, agreementId: true,
      agreement: { select: { lateFeeGraceDays: true, lateFeeCents: true, lateFeePercent: true } },
      customer: { select: { activeMilitary: true, user: { select: { name: true, email: true } } } },
      _count: { select: { pendingChargesFor: true } },
    },
  });
  if (!invoice || !invoice.dueDate || !invoice.agreement || !invoice.agreementId) return null;
  if (!(OPEN_STATUSES as readonly string[]).includes(invoice.status)) return null;
  const settings = await getBusinessSettings();
  const noticeDays = (settings as { lateFeeNoticeDaysBefore?: number }).lateFeeNoticeDaysBefore ?? LATE_FEE_NOTICE_DAYS_DEFAULT;

  // When was the customer warned? A delivered warning, or Chris's recorded phone call; the later one counts.
  let warnedAt: Date | null = invoice.lateFeeToldOn;
  if (invoice.lateNoticeDeliveryId) {
    const delivery = await db.messageDelivery.findUnique({
      where: { id: invoice.lateNoticeDeliveryId },
      select: { state: true, acceptedAt: true, deliveredAt: true, requestedAt: true },
    });
    if (delivery && (delivery.state === "ACCEPTED" || delivery.state === "DELIVERED")) {
      const at = delivery.acceptedAt ?? delivery.deliveredAt ?? delivery.requestedAt;
      if (!warnedAt || at.getTime() > warnedAt.getTime()) warnedAt = at;
    }
  }
  const failedAfter = warnedAt
    ? (await db.payment.count({ where: { invoiceId, status: "failed", createdAt: { gt: warnedAt } } })) > 0
    : false;
  const bankInFlight = await db.bankPaymentInFlight.count({ where: { invoiceId, clearedAt: null } });
  const phoneStarted = await db.auditLog.count({
    where: {
      action: "billing.phone_payment_started", entityType: "Invoice", entityId: invoiceId,
      createdAt: { gt: new Date(now.getTime() - PHONE_PAYMENT_WINDOW_MS) },
    },
  });
  const outstandingCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  const feeCents = lateFeeAmountCents({ flatCents: invoice.agreement.lateFeeCents, percent: invoice.agreement.lateFeePercent, outstandingCents });
  const dueKey = businessDateKey(invoice.dueDate);
  return {
    invoiceNumber: invoice.invoiceNumber,
    customerName: invoice.customer.user.name ?? invoice.customer.user.email,
    baseKey: baseFeeDateKey(dueKey, invoice.agreement.lateFeeGraceDays),
    noticeCount: invoice.lateNoticeCount,
    facts: {
      todayKey: businessDateKey(now),
      dueKey,
      graceDays: invoice.agreement.lateFeeGraceDays,
      noticeDays,
      warnedKey: warnedAt ? businessDateKey(warnedAt) : null,
      failedPaymentAfterWarning: failedAfter,
      outstandingCents,
      feeCents,
      militaryHold: invoice.customer.activeMilitary,
      agreementNamesFee: invoice.agreement.lateFeeCents > 0 || invoice.agreement.lateFeePercent > 0,
      paymentInProgress: bankInFlight > 0 || phoneStarted > 0,
      alreadyCharged: invoice._count.pendingChargesFor > 0 || invoice.lateFeeCents > 0,
    },
  };
}

function appBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}

export type SendNoticeResult = { state: "SENT" | "NOT_SENT" | "SKIPPED"; feeDateKey?: string };

/**
 * Warn the customer that a late fee is coming. The fee date is never earlier than the warning plus the notice days.
 * Safe to call again: the delivery has a fixed key per bill and warning number, and a delivered warning is recorded once.
 */
export async function sendLateNotice(invoiceId: string, now = new Date(), actorUserId: string | null = null): Promise<SendNoticeResult> {
  const loaded = await loadLateFeeFacts(prisma, invoiceId, now);
  if (!loaded || loaded.facts.alreadyCharged || loaded.facts.outstandingCents <= 0 || !loaded.facts.agreementNamesFee || loaded.facts.feeCents <= 0) {
    return { state: "SKIPPED" };
  }
  const invoice = await prisma.invoice.findUniqueOrThrow({
    where: { id: invoiceId },
    select: {
      invoiceNumber: true, lateNoticeCount: true, dueDate: true,
      customer: { select: { id: true, user: { select: { name: true, email: true } } } },
    },
  });
  const feeDateKey = feeDateAfterNoticeKey(loaded.baseKey, loaded.facts.todayKey, loaded.facts.noticeDays);
  const retry = loaded.facts.failedPaymentAfterWarning;
  const number = invoice.lateNoticeCount + 1;
  const { customerMessageLanguage } = await import("@/domains/language/message-language");
  const { activeMessageCatalog } = await import("@/domains/language/runtime");
  const language = await customerMessageLanguage(invoice.customer.id);
  const catalog = await activeMessageCatalog(language);
  const t = (key: Parameters<typeof messageText>[1], values?: Record<string, string>) => messageText(language, key, values, catalog);
  const dateLabel = (key: string) =>
    (businessDateFromKey(key) ?? new Date(`${key}T12:00:00Z`)).toLocaleDateString(language === "es" ? "es-US" : "en-US", {
      timeZone: "America/Denver", month: "long", day: "numeric",
    });
  const delivery = await deliverMessage({
    idempotencyKey: `late-notice-${invoiceId}-${number}`,
    channel: "EMAIL",
    purpose: "TRANSACTIONAL",
    templateKey: "late-payment-notice",
    customerFacing: true,
    recipient: { type: "Customer", id: invoice.customer.id, address: invoice.customer.user.email },
    subject: { type: "Invoice", id: invoiceId },
    render: () => ({
      subject: t("lateNoticeSubject"),
      text: [
        t("quoteHello", { name: invoice.customer.user.name ? ` ${invoice.customer.user.name}` : "" }),
        ...(retry ? [t("lateNoticeRetry")] : []),
        t("lateNoticeIntro", {
          amount: formatCents(loaded.facts.outstandingCents),
          number: String(invoice.invoiceNumber),
          due: dateLabel(loaded.facts.dueKey),
          feeDate: dateLabel(feeDateKey),
          fee: formatCents(loaded.facts.feeCents),
        }),
        `${t("lateNoticePay")} ${appBaseUrl()}/account/billing`,
        t("billingReply"),
      ].join("\n\n"),
    }),
  });
  if (delivery.state !== "ACCEPTED" && delivery.state !== "DELIVERED") return { state: "NOT_SENT" };

  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const current = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { lateNoticeCount: true } });
    if (current.lateNoticeCount !== invoice.lateNoticeCount) return; // another run already recorded this warning
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { lateNoticeDeliveryId: delivery.deliveryId, lateNoticeCount: number, lateFeeDate: businessDateFromKey(feeDateKey) },
    });
    await tx.auditLog.create({
      data: {
        userId: actorUserId, action: "billing.late_notice_sent", entityType: "Invoice", entityId: invoiceId,
        newValue: { deliveryId: delivery.deliveryId, feeDate: feeDateKey, feeCents: loaded.facts.feeCents, afterFailedPayment: retry },
      },
    });
  });
  return { state: "SENT", feeDateKey };
}

/** Record the fee as a pending charge, re-checking every rule under the bill's lock. Returns null when no fee is due now. */
export async function recordLateFee(invoiceId: string, now = new Date()): Promise<RecordedLateFee | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const loaded = await loadLateFeeFacts(tx, invoiceId, now);
    if (!loaded) return null;
    const decision = decideLateFee(loaded.facts);
    if (decision.kind !== "RECORD_FEE") return null;
    const invoice = await tx.invoice.findUniqueOrThrow({
      where: { id: invoiceId }, select: { customerId: true, agreementId: true, lateNoticeDeliveryId: true, lateFeeDate: true },
    });
    if (!invoice.agreementId) return null;
    const created = await tx.pendingCharge.createMany({
      data: [{
        customerId: invoice.customerId, agreementId: invoice.agreementId, kind: "LATE_FEE", amountCents: decision.feeCents,
        forInvoiceId: invoiceId, noticeDeliveryId: invoice.lateNoticeDeliveryId, addedOn: now,
      }],
      skipDuplicates: true, // the unique key (bill, kind) is what keeps this to once per bill, even if two runs overlap
    });
    if (created.count === 0) return null;
    await tx.auditLog.create({
      data: {
        action: "billing.late_fee_recorded", entityType: "Invoice", entityId: invoiceId,
        newValue: { feeCents: decision.feeCents, noticeDeliveryId: invoice.lateNoticeDeliveryId, feeDate: loaded.facts.todayKey },
      },
    });
    return { invoiceId, invoiceNumber: loaded.invoiceNumber, customerName: loaded.customerName, feeCents: decision.feeCents };
  }, { maxWait: 10_000, timeout: 30_000 });
}

function countDecision(counts: LateFeeRunCounts, decision: LateFeeDecision) {
  if (decision.kind === "NEEDS_WARNING") counts.needsWarning += 1;
  else if (decision.kind === "MILITARY_REVIEW") counts.militaryReview += 1;
  else if (decision.kind === "WAIT" && decision.reason === "PAYMENT_IN_PROGRESS") counts.waitingForPayment += 1;
}

/** Nightly: warn customers whose fee day is near, and record fees for customers who were warned and did not pay. */
export async function runLateFees(now = new Date()): Promise<{ counts: LateFeeRunCounts; recorded: RecordedLateFee[] }> {
  const counts: LateFeeRunCounts = {
    checked: 0, noticesSent: 0, noticesNotSent: 0, feesRecorded: 0, needsWarning: 0, militaryReview: 0, waitingForPayment: 0,
    billedLocal: 0, sentToStripe: 0, waitingForNextBill: 0, stripeBillingOff: 0, errors: 0,
  };
  const recorded: RecordedLateFee[] = [];
  const oldest = new Date(now.getTime() - 40 * 86_400_000); // past the 30-day window nothing is assessed
  let afterId: string | null = null;
  for (;;) {
    const batch: Array<{ id: string }> = await prisma.invoice.findMany({
      where: {
        status: { in: [...OPEN_STATUSES] },
        dueDate: { not: null, lte: now, gte: oldest },
        lateFeeCents: 0,
        agreementId: { not: null },
        pendingChargesFor: { none: {} },
        ...(afterId ? { id: { gt: afterId } } : {}),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: BATCH_SIZE,
    });
    for (const candidate of batch) {
      try {
        const loaded = await loadLateFeeFacts(prisma, candidate.id, now);
        if (!loaded) continue;
        counts.checked += 1;
        const decision = decideLateFee(loaded.facts);
        countDecision(counts, decision);
        if (decision.kind === "SEND_NOTICE" || decision.kind === "RENOTICE") {
          const sent = await sendLateNotice(candidate.id, now);
          if (sent.state === "SENT") counts.noticesSent += 1;
          else if (sent.state === "NOT_SENT") counts.noticesNotSent += 1;
        } else if (decision.kind === "RECORD_FEE") {
          const fee = await recordLateFee(candidate.id, now);
          if (fee) {
            recorded.push(fee);
            counts.feesRecorded += 1;
          }
        }
      } catch (error) {
        counts.errors += 1;
        console.error("[billing] Late-fee check failed for one bill", candidate.id, error instanceof Error ? error.message : error);
      }
    }
    if (batch.length < BATCH_SIZE) break;
    afterId = batch[batch.length - 1]!.id;
  }
  return { counts, recorded };
}

// ---------------------------------------------------------------------------------------------------------------
// Putting a recorded fee on the customer's next bill.

function lateFeeDescription(invoiceNumber: number, dueDate: Date | null): string {
  const due = dueDate ? dueDate.toLocaleDateString("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }) : "";
  return `Late fee for bill #${invoiceNumber}${due ? ` (was due ${due})` : ""}`;
}

function intentHash(input: { chargeId: string; customerId: string; subscriptionId: string; amountCents: number; description: string }): string {
  return createHash("sha256").update(JSON.stringify({ v: 1, ...input, currency: "usd" })).digest("hex");
}

/** Send one pending fee to Stripe as an invoice item for the customer's UPCOMING subscription bill. Idempotent. */
async function sendFeeToStripe(chargeId: string, stripe: Stripe): Promise<"sent" | "already" | "skipped"> {
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PendingCharge" WHERE "id" = ${chargeId} FOR UPDATE`;
    const charge = await tx.pendingCharge.findUniqueOrThrow({
      where: { id: chargeId },
      select: {
        amountCents: true, waivedAt: true, appliedToInvoiceId: true, customerId: true,
        forInvoice: { select: { invoiceNumber: true, dueDate: true } },
        agreement: { select: { stripeSubscriptionId: true } },
        customer: { select: { stripeCustomerId: true } },
      },
    });
    if (charge.waivedAt || charge.appliedToInvoiceId) return null;
    const subscriptionId = charge.agreement.stripeSubscriptionId;
    const customerId = charge.customer.stripeCustomerId;
    if (!subscriptionId || !customerId) return null;
    const description = lateFeeDescription(charge.forInvoice.invoiceNumber, charge.forInvoice.dueDate);
    const idempotencyKey = `late-fee-${chargeId}`;
    const claim = await claimProviderOperation(tx, { kind: "LATE_FEE_INVOICE_ITEM", subjectType: "PendingCharge", subjectId: chargeId, idempotencyKey });
    if (claim.done) return { done: true as const };
    const hash = intentHash({ chargeId, customerId, subscriptionId, amountCents: charge.amountCents, description });
    const hasIntent = await tx.auditLog.findFirst({ where: { action: "billing.late_fee_provider_intent", entityType: "ProviderOperation", entityId: claim.opId }, select: { id: true } });
    if (!hasIntent) {
      await tx.auditLog.create({
        data: { action: "billing.late_fee_provider_intent", entityType: "ProviderOperation", entityId: claim.opId, newValue: { chargeId, amountCents: charge.amountCents, hash } },
      });
    }
    await tx.pendingCharge.update({ where: { id: chargeId }, data: { providerOperationId: claim.opId } });
    return { done: false as const, opId: claim.opId, idempotencyKey: claim.idempotencyKey, customerId, subscriptionId, amountCents: charge.amountCents, description };
  });
  if (!prepared) return "skipped";
  if (prepared.done) return "already";
  const result = await runProviderCall(() =>
    stripe.invoiceItems.create(
      {
        customer: prepared.customerId,
        subscription: prepared.subscriptionId,
        amount: prepared.amountCents,
        currency: "usd",
        description: prepared.description,
        tax_rates: [], // a late fee is not sales-taxed here; the tax answer is a Decisions & reviews question
        metadata: { late_fee_pending_charge_id: chargeId },
      },
      { idempotencyKey: prepared.idempotencyKey },
    ),
  );
  await prisma.$transaction(async (tx) => {
    if (result.ok) await completeProviderOperation(tx, prepared.opId, { status: "SUCCEEDED", providerObjectId: result.value.id });
    else await completeProviderOperation(tx, prepared.opId, { status: result.outcome, error: result.error });
  });
  if (!result.ok) throw new Error("Stripe did not accept the late fee yet; it will be tried again.");
  return "sent";
}

/** A rental that is over, or cannot take a fee, gets a separate one-line bill that is never charged automatically. */
async function createSeparateFeeBill(chargeId: string, now: Date): Promise<boolean> {
  const settings = await getBusinessSettings();
  const dueDays = (settings as { dueDays?: number }).dueDays ?? 14;
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "PendingCharge" WHERE "id" = ${chargeId} FOR UPDATE`;
    const charge = await tx.pendingCharge.findUniqueOrThrow({
      where: { id: chargeId },
      select: { amountCents: true, waivedAt: true, appliedToInvoiceId: true, customerId: true, agreementId: true, forInvoice: { select: { invoiceNumber: true, dueDate: true } } },
    });
    if (charge.waivedAt || charge.appliedToInvoiceId) return false;
    const invoice = await tx.invoice.create({
      data: {
        customerId: charge.customerId, agreementId: charge.agreementId, status: "OPEN",
        subtotalCents: charge.amountCents, amountDueCents: charge.amountCents, amountPaidCents: 0, taxCents: 0, discountCents: 0,
        dueDate: new Date(now.getTime() + dueDays * 86_400_000), issuedAt: now,
        lineItems: { create: { kind: "LATE_FEE", description: lateFeeDescription(charge.forInvoice.invoiceNumber, charge.forInvoice.dueDate), amountCents: charge.amountCents } },
      },
      select: { id: true },
    });
    await tx.pendingCharge.update({ where: { id: chargeId }, data: { appliedToInvoiceId: invoice.id } });
    await tx.auditLog.create({
      data: { action: "billing.late_fee_billed_separately", entityType: "PendingCharge", entityId: chargeId, newValue: { invoiceId: invoice.id, amountCents: charge.amountCents } },
    });
    return true;
  });
}

/** Nightly: put recorded fees on the customer's next bill (Stripe item, or a separate local bill). Never on a payment in progress. */
export async function billPendingLateFees(now = new Date(), stripeClient?: Stripe): Promise<Partial<LateFeeRunCounts>> {
  const counts = { billedLocal: 0, sentToStripe: 0, waitingForNextBill: 0, stripeBillingOff: 0, errors: 0 };
  const todayKey = businessDateKey(now);
  const charges = await prisma.pendingCharge.findMany({
    where: { kind: "LATE_FEE", waivedAt: null, appliedToInvoiceId: null },
    select: {
      id: true,
      agreement: { select: { status: true, stripeSubscriptionId: true, nextBillingDate: true, terminationEffectiveOn: true } },
      customer: { select: { stripeCustomerId: true } },
    },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
  });
  for (const charge of charges) {
    try {
      const agreement = charge.agreement;
      const nextKey = agreement.nextBillingDate ? businessDateKey(agreement.nextBillingDate) : null;
      const ending = agreement.status !== "ACTIVE"
        || Boolean(agreement.terminationEffectiveOn && agreement.nextBillingDate && agreement.terminationEffectiveOn.getTime() <= agreement.nextBillingDate.getTime());
      const onStripe = Boolean(agreement.stripeSubscriptionId && charge.customer.stripeCustomerId);
      if (!onStripe || ending) {
        if (await createSeparateFeeBill(charge.id, now)) counts.billedLocal += 1;
        continue;
      }
      if (!canJoinNextCharge({ todayKey, nextChargeKey: nextKey, autopay: true })) {
        counts.waitingForNextBill += 1; // the next automatic charge is less than 10 days away: wait for the one after
        continue;
      }
      if (!lateFeeBillingEnabled()) {
        counts.stripeBillingOff += 1;
        continue;
      }
      const outcome = await sendFeeToStripe(charge.id, stripeClient ?? getStripeClient());
      if (outcome === "sent") counts.sentToStripe += 1;
    } catch (error) {
      counts.errors += 1;
      console.error("[billing] Could not put a late fee on the next bill", charge.id, error instanceof Error ? error.message : error);
    }
  }
  return counts;
}

/** Waive a recorded fee. Before it is billed it is simply never billed; if it is already on a bill, a credit line removes it. */
export async function waiveLateFee(chargeId: string, actorUserId: string, reason: string, now = new Date()): Promise<"waived" | "credited" | "already"> {
  const cleaned = reason.trim();
  if (cleaned.length < 3) throw new Error("Add a short reason for waiving the fee.");
  return prisma.$transaction(async (tx) => {
    const { assertActiveTeamActor } = await import("@/lib/team-actor");
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "PendingCharge" WHERE "id" = ${chargeId} FOR UPDATE`;
    const charge = await tx.pendingCharge.findUniqueOrThrow({
      where: { id: chargeId },
      select: { amountCents: true, waivedAt: true, appliedToInvoiceId: true, customerId: true, forInvoiceId: true },
    });
    if (charge.waivedAt) return "already" as const;
    await tx.pendingCharge.update({ where: { id: chargeId }, data: { waivedAt: now, waivedReason: cleaned, waivedByUserId: actorUserId } });
    let outcome: "waived" | "credited" = "waived";
    if (charge.appliedToInvoiceId) {
      // Already on a bill the customer received: the bill keeps showing it, and the customer gets the same amount back as a credit.
      await tx.customerCredit.create({
        data: {
          customerId: charge.customerId, amountCents: charge.amountCents, remainingCents: charge.amountCents,
          reason: "Late fee waived", notes: cleaned, authorizedByUserId: actorUserId,
          sourceType: "LATE_FEE_WAIVER", sourceId: chargeId, side: "CUSTOMER",
        },
      });
      outcome = "credited";
    }
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "billing.late_fee_waived", entityType: "PendingCharge", entityId: chargeId, newValue: { reason: cleaned, outcome, amountCents: charge.amountCents, forInvoiceId: charge.forInvoiceId } },
    });
    return outcome;
  });
}

/** "Skip the fee": no fee for this bill, on purpose. Kept as a waived charge so the bill can never get a fee later. */
export async function skipLateFee(invoiceId: string, actorUserId: string, reason: string, now = new Date()): Promise<"skipped" | "already"> {
  const cleaned = reason.trim();
  if (cleaned.length < 3) throw new Error("Add a short reason for skipping the fee.");
  return prisma.$transaction(async (tx) => {
    const { assertActiveTeamActor } = await import("@/lib/team-actor");
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { customerId: true, agreementId: true, amountDueCents: true, agreement: { select: { lateFeeCents: true, lateFeePercent: true } } } });
    if (!invoice.agreementId || !invoice.agreement) throw new Error("This bill has no rental agreement, so it has no late fee.");
    const feeCents = lateFeeAmountCents({ flatCents: invoice.agreement.lateFeeCents, percent: invoice.agreement.lateFeePercent, outstandingCents: invoice.amountDueCents });
    const created = await tx.pendingCharge.createMany({
      data: [{ customerId: invoice.customerId, agreementId: invoice.agreementId, kind: "LATE_FEE", amountCents: feeCents, forInvoiceId: invoiceId, addedOn: now, waivedAt: now, waivedReason: cleaned, waivedByUserId: actorUserId }],
      skipDuplicates: true,
    });
    if (created.count === 0) return "already" as const;
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "billing.late_fee_skipped", entityType: "Invoice", entityId: invoiceId, newValue: { reason: cleaned, feeCents } },
    });
    return "skipped" as const;
  });
}

/** Chris tells us he warned the customer himself (phone call). Counts as the warning; the fee date follows the usual notice days. */
export async function recordToldByPhone(invoiceId: string, actorUserId: string, now = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const { assertActiveTeamActor } = await import("@/lib/team-actor");
    await assertActiveTeamActor(tx, actorUserId, ["OWNER", "ADMIN"]);
    await tx.$queryRaw`SELECT "id" FROM "Invoice" WHERE "id" = ${invoiceId} FOR UPDATE`;
    const loaded = await loadLateFeeFacts(tx, invoiceId, now);
    if (!loaded) throw new Error("This bill is not overdue any more.");
    const feeDateKey = feeDateAfterNoticeKey(loaded.baseKey, businessDateKey(now), loaded.facts.noticeDays);
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { lateFeeToldOn: now, lateFeeToldByUserId: actorUserId, lateFeeDate: businessDateFromKey(feeDateKey) },
    });
    await tx.auditLog.create({
      data: { userId: actorUserId, action: "billing.late_fee_told_by_phone", entityType: "Invoice", entityId: invoiceId, newValue: { feeDate: feeDateKey } },
    });
  });
}

export { addDaysToKey };
