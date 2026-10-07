import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { addBusinessDays, businessDaysBetween, businessEndOfDay, formatBusinessDate } from "@/lib/business-date";
import { formatCents } from "@/domains/pricing";
import { lockCustomerLedger } from "@/domains/billing/ledger";
import { sumTax } from "@/domains/billing/tax";
import { applyLocalInvoiceTaxInTx } from "@/domains/tax/local-invoice";
import {
  billingPeriodContaining,
  lastChargeableDayKey,
  pickupBillingSettingsFrom,
} from "@/domains/billing/pickup-billing";
import { agreedEndFor, isSupersededAssignment, itemsForAppliances } from "@/domains/billing/pickup-billing-events";
import { refundAcrossPaidInvoicesInTx, type RefundAcrossRun } from "@/domains/billing/refund-across-invoices";
import { runPreparedInvoiceRefund } from "@/domains/billing/refunds";
import { applySubscriptionEnds, recomputeForAgreementInTx } from "@/domains/billing/subscription-end";
import {
  earlyReturnSettingsFrom,
  type EarlyReturnSettings,
} from "@/domains/settings/early-return";
import { closeAgreementInTx, lockRentalAgreementInTx, runCloseAgreementContinuation, type CloseAgreementResult } from "./index";
import { quoteEarlyTermination, loadTermAgreement, type EarlyTerminationQuote } from "./term";
import { effectiveMonthToMonthTerms, quoteMonthToMonthEnd, type MonthToMonthTerms } from "./month-to-month";
import { snapshotTerminationPolicy } from "./terms-snapshot";
import { cancelWithdrawnAutoRenewals } from "./auto-renew";

/**
 * Early returns (docs/designs/BATCH-B2.md B2-19, owner answer IN-29): everything came back before the agreed ending,
 * or with no ending recorded. The owner chooses what happens to billing, to the days already paid for, and to the
 * early-ending fee. Defaults come from his settings; nothing here is a hard-coded policy.
 */

export type EarlyReturnChoice = {
  billing: "KEEP_TO_AGREED_END" | "END_AT_PICKUP";
  /** Ignored unless the rental ends at pickup. */
  unusedDays: "KEEP" | "CREDIT" | "REFUND";
  /** Fixed term only (month-to-month never has a fee). `AGREED_TERMS` = the fee in the rental's own signed terms. */
  feeCents: number | "AGREED_TERMS" | 0;
  /** Required when `feeCents` is a number other than 0 or the quoted fee. */
  feeReason?: string;
};

export type EarlyReturnPreview = {
  /** The last day the customer has paid for under what is recorded now (null: no ending recorded). */
  agreedEndOn: Date | null;
  /** The last day the customer is billed under this choice. */
  lastBilledDay: Date;
  unusedDaysCount: number;
  unusedCents: number;
  unusedTaxCents: number;
  quotedFeeCents: number;
  feeCents: number;
  /** What goes back to the customer (refund or credit) under this choice, with tax. */
  refundOrCreditCents: number;
  prepaidNeedsOwner: boolean;
};

export type EarlyReturnApplied = {
  resolutionId: string;
  close: CloseAgreementResult | null;
  refundRuns: RefundAcrossRun[];
  creditId: string | null;
  subscriptionEndIds: string[];
  agreementId: string;
  /** True when a new ending was recorded, so an automatic renewal made from this rental must be withdrawn. */
  endingRecorded: boolean;
};

export type ReturnPickup = { jobId: string; pickupDate: Date };

const PREPAID_MESSAGE = "This rental was paid in advance: settle it from the agreement page.";
const STALE_MESSAGE = "The numbers changed. Review them again.";

/** The defaults the owner set, as one rental's choice. */
export function choiceFromSettings(settings: EarlyReturnSettings): EarlyReturnChoice {
  return {
    billing: settings.billing,
    unusedDays: settings.unusedDays,
    feeCents: settings.fee === "AGREED_TERMS_FEE" ? "AGREED_TERMS" : 0,
  };
}

/** Same everything a person saw: used to tell whether the numbers moved between "preview" and "confirm". */
export function previewFingerprint(p: EarlyReturnPreview): string {
  return JSON.stringify([
    p.agreedEndOn?.getTime() ?? null,
    p.lastBilledDay.getTime(),
    p.unusedDaysCount,
    p.unusedCents,
    p.unusedTaxCents,
    p.quotedFeeCents,
    p.feeCents,
    p.refundOrCreditCents,
    p.prepaidNeedsOwner,
  ]);
}

export function serializePreview(p: EarlyReturnPreview): string {
  return JSON.stringify({
    ...p,
    agreedEndOn: p.agreedEndOn ? p.agreedEndOn.toISOString() : null,
    lastBilledDay: p.lastBilledDay.toISOString(),
  });
}

export function parsePreview(text: string): EarlyReturnPreview {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const num = (k: string) => {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isInteger(v)) throw new Error(STALE_MESSAGE);
    return v;
  };
  const day = (v: unknown) => {
    if (typeof v !== "string" || Number.isNaN(Date.parse(v))) throw new Error(STALE_MESSAGE);
    return new Date(v);
  };
  return {
    agreedEndOn: raw.agreedEndOn === null || raw.agreedEndOn === undefined ? null : day(raw.agreedEndOn),
    lastBilledDay: day(raw.lastBilledDay),
    unusedDaysCount: num("unusedDaysCount"),
    unusedCents: num("unusedCents"),
    unusedTaxCents: num("unusedTaxCents"),
    quotedFeeCents: num("quotedFeeCents"),
    feeCents: num("feeCents"),
    refundOrCreditCents: num("refundOrCreditCents"),
    prepaidNeedsOwner: raw.prepaidNeedsOwner === true,
  };
}

type Db = Prisma.TransactionClient;

/** When and by which job the last of the equipment came back. */
export async function loadReturnPickup(db: Db | typeof prisma, agreementId: string): Promise<ReturnPickup | null> {
  const episode = await db.applianceCustodyEpisode.findFirst({
    where: { agreementId, closedAt: { not: null } },
    orderBy: [{ closedAt: "desc" }, { id: "desc" }],
    select: { endJobId: true, endedOn: true, closedAt: true },
  });
  const when = episode?.endedOn ?? episode?.closedAt;
  if (!episode || !when) return null;
  return { jobId: episode.endJobId ?? "manual", pickupDate: when };
}

type FeeResolution = { feeCents: number; feeReason: string | null };

function resolveFee(choice: EarlyReturnChoice, quotedFeeCents: number, fixedTerm: boolean): FeeResolution {
  const raw = choice.feeCents;
  if (!fixedTerm) {
    if (typeof raw === "number" && raw !== 0) throw new Error("A month-to-month rental never has an early-ending fee.");
    return { feeCents: 0, feeReason: null };
  }
  if (raw === "AGREED_TERMS") return { feeCents: quotedFeeCents, feeReason: null };
  if (!Number.isInteger(raw) || raw < 0 || raw > 10_000_000) throw new Error("The fee must be a whole number of cents, zero or more.");
  if (raw === 0 || raw === quotedFeeCents) return { feeCents: raw, feeReason: null };
  const reason = choice.feeReason?.trim() ?? "";
  if (reason.length < 5 || reason.length > 500) {
    throw new Error(
      raw > quotedFeeCents
        ? "A fee above the rental's agreed fee needs a written reason (5 to 500 characters)."
        : "A fee different from the rental's agreed fee needs a written reason (5 to 500 characters).",
    );
  }
  return { feeCents: raw, feeReason: reason };
}

type ExistingResolution = NonNullable<Awaited<ReturnType<Db["earlyReturnResolution"]["findUnique"]>>>;

type Plan = {
  preview: EarlyReturnPreview;
  fee: FeeResolution;
  choice: EarlyReturnChoice;
  endAtPickup: boolean;
  fixedTerm: boolean;
  record:
    | null
    | { kind: "FIXED"; quote: EarlyTerminationQuote }
    | { kind: "MTM"; terms: MonthToMonthTerms; effectiveOn: Date };
  lastBilledEnd: Date;
  unusedLines: Array<{ label: string; amountCents: number; rentalLineId: string }>;
  existing: ExistingResolution | null;
  /** The agreement still carries an ending that an earlier automatic resolution recorded; a change first removes it. */
  undoRecordedEnding: boolean;
  agreement: {
    id: string;
    customerId: string;
    status: string;
    termMonths: number | null;
    paidInFullInAdvance: boolean;
  };
};

/** Did the automatic resolution on this agreement record a new ending (as opposed to finding one already there)? */
async function resolutionRecordedEnding(tx: Db, agreementId: string): Promise<boolean> {
  const audit = await tx.auditLog.findFirst({
    where: { action: "agreement.early_return_resolved", entityType: "RentalAgreement", entityId: agreementId },
    orderBy: { createdAt: "desc" },
    select: { newValue: true },
  });
  const value = audit?.newValue as { endingRecorded?: boolean } | null | undefined;
  return value?.endingRecorded === true;
}

async function planInTx(
  tx: Db,
  agreementId: string,
  pickup: ReturnPickup,
  choice: EarlyReturnChoice,
): Promise<Plan> {
  const settingsRow = await tx.businessSettings.findUnique({ where: { id: "singleton" } });
  const settings = earlyReturnSettingsFrom(settingsRow);
  const pickupSettings = pickupBillingSettingsFrom(settingsRow ?? {});
  const existing = await tx.earlyReturnResolution.findUnique({ where: { agreementId } });
  const row = await tx.rentalAgreement.findUniqueOrThrow({
    where: { id: agreementId },
    select: {
      id: true,
      customerId: true,
      status: true,
      termMonths: true,
      endDate: true,
      nextBillingDate: true,
      billingStartedAt: true,
      paidInFullInAdvance: true,
      taxRateMilliPercent: true,
      terminationRequestedAt: true,
      terminationEffectiveOn: true,
      terminationFeeCents: true,
      termsSnapshot: true,
    },
  });
  const fixedTerm = row.termMonths !== null;
  const undoRecordedEnding =
    !!existing &&
    existing.appliedBy === "DEFAULTS" &&
    existing.billing === "KEEP_TO_AGREED_END" &&
    row.status === "ACTIVE" &&
    !!row.terminationRequestedAt &&
    (await resolutionRecordedEnding(tx, agreementId));
  // A change of mind sees the rental as it was before the automatic choice recorded its ending.
  const agreement = undoRecordedEnding
    ? { ...row, terminationRequestedAt: null, terminationEffectiveOn: null, terminationFeeCents: null }
    : row;
  const base = { id: row.id, customerId: row.customerId, status: row.status, termMonths: row.termMonths, paidInFullInAdvance: row.paidInFullInAdvance };

  const emptyPreview = (partial: Partial<EarlyReturnPreview> = {}): EarlyReturnPreview => ({
    agreedEndOn: agreedEndFor(agreement),
    lastBilledDay: agreedEndFor(agreement) ?? pickup.pickupDate,
    unusedDaysCount: 0,
    unusedCents: 0,
    unusedTaxCents: 0,
    quotedFeeCents: 0,
    feeCents: 0,
    refundOrCreditCents: 0,
    prepaidNeedsOwner: false,
    ...partial,
  });

  if (agreement.paidInFullInAdvance) {
    return {
      preview: emptyPreview({ prepaidNeedsOwner: true }),
      fee: { feeCents: 0, feeReason: null },
      choice,
      endAtPickup: choice.billing === "END_AT_PICKUP",
      fixedTerm,
      record: null,
      lastBilledEnd: pickup.pickupDate,
      unusedLines: [],
      existing,
      undoRecordedEnding,
      agreement: base,
    };
  }

  // What the rental's own signed terms would charge for ending early (fixed term only).
  const policy = fixedTerm ? snapshotTerminationPolicy(row.termsSnapshot) : null;
  let fixedQuote: EarlyTerminationQuote | null = null;
  let quotedFeeCents = 0;
  if (fixedTerm) {
    if (agreement.terminationRequestedAt) {
      quotedFeeCents = agreement.terminationFeeCents ?? 0;
    } else if (policy && agreement.nextBillingDate && agreement.endDate) {
      const termAgreement = await loadTermAgreement(tx, agreementId);
      fixedQuote = quoteEarlyTermination(termAgreement, policy, pickup.pickupDate);
      quotedFeeCents = fixedQuote.feeCents;
    }
  }

  if (choice.billing === "KEEP_TO_AGREED_END") {
    // An ending is already recorded when one was requested, or when a fixed term has no early-ending terms to quote.
    const endingAlreadyRecorded = !!agreement.terminationRequestedAt || (fixedTerm && !fixedQuote);
    if (endingAlreadyRecorded) {
      const agreedEnd = agreedEndFor(agreement) ?? pickup.pickupDate;
      const recordedFee = agreement.terminationFeeCents ?? 0;
      return {
        preview: emptyPreview({ lastBilledDay: agreedEnd, quotedFeeCents, feeCents: recordedFee }),
        fee: { feeCents: recordedFee, feeReason: null },
        choice,
        endAtPickup: false,
        fixedTerm,
        record: null,
        lastBilledEnd: agreedEnd,
        unusedLines: [],
        existing,
        undoRecordedEnding,
        agreement: base,
      };
    }
    const fee = resolveFee(choice, quotedFeeCents, fixedTerm);
    if (fixedQuote) {
      const lastBilled = addBusinessDays(fixedQuote.effectiveOn, -1);
      return {
        preview: emptyPreview({ lastBilledDay: lastBilled, quotedFeeCents, feeCents: fee.feeCents }),
        fee,
        choice,
        endAtPickup: false,
        fixedTerm,
        record: { kind: "FIXED", quote: fixedQuote },
        lastBilledEnd: businessEndOfDay(lastBilled),
        unusedLines: [],
        existing,
        undoRecordedEnding,
        agreement: base,
      };
    }
    // Month-to-month with no ending recorded: its own notice rules, as if requested on the pickup day.
    if (!agreement.nextBillingDate) {
      throw new Error("Billing for this rental has not started yet, so there is nothing to keep billing. End it from the agreement page.");
    }
    const terms = await effectiveMonthToMonthTerms(tx, agreementId, pickup.pickupDate);
    if (!terms) throw new Error("This rental has no ending notice terms recorded. End it from the agreement page.");
    const quote = quoteMonthToMonthEnd({ nextBillingDate: agreement.nextBillingDate, terms }, pickup.pickupDate);
    return {
      preview: emptyPreview({ lastBilledDay: quote.lastBilledDay, quotedFeeCents: 0, feeCents: 0 }),
      fee,
      choice,
      endAtPickup: false,
      fixedTerm,
      record: { kind: "MTM", terms, effectiveOn: quote.effectiveOn },
      lastBilledEnd: businessEndOfDay(quote.lastBilledDay),
      unusedLines: [],
      existing,
      undoRecordedEnding,
      agreement: base,
    };
  }

  // END_AT_PICKUP: billing stops at the last chargeable day; the days already paid for after it are settled per choice.
  const fee = resolveFee(choice, quotedFeeCents, fixedTerm);
  const lastBilledDay = new Date(`${lastChargeableDayKey(pickup.pickupDate, pickupSettings)}T12:00:00Z`);
  const unusedLines: Plan["unusedLines"] = [];
  let unusedDaysCount = 0;
  if (agreement.billingStartedAt && businessDaysBetween(agreement.billingStartedAt, pickup.pickupDate) >= 0) {
    const period = billingPeriodContaining(agreement.billingStartedAt, pickup.pickupDate);
    const periodLastDay = addBusinessDays(period.end, -1);
    const agreedEnd = agreedEndFor(agreement);
    const paidThrough = agreedEnd && businessDaysBetween(agreedEnd, periodLastDay) > 0 ? agreedEnd : periodLastDay;
    const firstUnused = addBusinessDays(lastBilledDay, 1);
    unusedDaysCount = Math.max(0, businessDaysBetween(firstUnused, paidThrough) + 1);
    if (unusedDaysCount > 0) {
      const basisDays = settings.prorationBasis === "ACTUAL_DAYS_IN_MONTH" ? businessDaysBetween(period.start, period.end) : 30;
      const assignments = await tx.applianceAssignment.findMany({
        where: { rentalLine: { agreementId } },
        select: { applianceId: true, unassignReason: true },
      });
      const applianceIds = [
        ...new Set(assignments.filter((a) => !isSupersededAssignment(a.unassignReason)).map((a) => a.applianceId)),
      ];
      const items = await itemsForAppliances(tx, agreementId, applianceIds);
      for (const item of items) {
        const amountCents = Math.min(item.monthlyPriceCents, Math.round((item.monthlyPriceCents * unusedDaysCount) / basisDays));
        if (amountCents > 0) {
          unusedLines.push({
            label: `Unused days after return – ${item.label} – ${unusedDaysCount} ${unusedDaysCount === 1 ? "day" : "days"}`,
            amountCents,
            rentalLineId: item.rentalLineId,
          });
        }
      }
    }
  }
  const unusedCents = unusedLines.reduce((sum, l) => sum + l.amountCents, 0);
  const unusedTaxCents = sumTax(unusedLines, agreement.taxRateMilliPercent);
  const refundOrCreditCents = choice.unusedDays === "KEEP" ? 0 : unusedCents + unusedTaxCents;
  return {
    preview: emptyPreview({
      lastBilledDay,
      unusedDaysCount,
      unusedCents,
      unusedTaxCents,
      quotedFeeCents,
      feeCents: fee.feeCents,
      refundOrCreditCents,
    }),
    fee,
    choice,
    endAtPickup: true,
    fixedTerm,
    record: null,
    lastBilledEnd: businessEndOfDay(lastBilledDay),
    unusedLines,
    existing,
    undoRecordedEnding,
    agreement: base,
  };
}

/** Same as `previewEarlyReturn`, inside a caller's transaction (used when the defaults are applied at completion). */
export async function previewEarlyReturnInTx(tx: Db, agreementId: string, pickup: ReturnPickup, choice: EarlyReturnChoice): Promise<EarlyReturnPreview> {
  return (await planInTx(tx, agreementId, pickup, choice)).preview;
}

/** What a choice would do, without changing anything. */
export async function previewEarlyReturn(agreementId: string, choice: EarlyReturnChoice): Promise<EarlyReturnPreview> {
  return prisma.$transaction(async (tx) => {
    const pickup = await loadReturnPickup(tx, agreementId);
    if (!pickup) throw new Error("No equipment has come back from this rental yet.");
    return (await planInTx(tx, agreementId, pickup, choice)).preview;
  });
}

export async function applyEarlyReturnInTx(
  tx: Prisma.TransactionClient,
  actor: { userId: string | null; by: "OWNER" | "DEFAULTS" },
  input: { agreementId: string; jobId: string; pickupDate: Date; choice: EarlyReturnChoice; expectedPreview: EarlyReturnPreview },
): Promise<EarlyReturnApplied> {
  // Same order as the rest of billing: the customer's ledger, then the agreement, then invoices.
  const peek = await tx.rentalAgreement.findUniqueOrThrow({ where: { id: input.agreementId }, select: { customerId: true } });
  await lockCustomerLedger(tx, peek.customerId);
  await lockRentalAgreementInTx(tx, input.agreementId);

  const pickup: ReturnPickup = { jobId: input.jobId, pickupDate: input.pickupDate };
  const plan = await planInTx(tx, input.agreementId, pickup, input.choice);
  const { agreement, existing } = plan;

  if (agreement.paidInFullInAdvance) throw new Error(PREPAID_MESSAGE);
  if (previewFingerprint(plan.preview) !== previewFingerprint(input.expectedPreview)) throw new Error(STALE_MESSAGE);
  if (existing && actor.by === "DEFAULTS") throw new Error("This rental's early return was already settled.");
  if (existing && existing.appliedBy !== "DEFAULTS") throw new Error("This early return was already settled by the owner.");

  const subscriptionEndIds: string[] = [];
  let feeInvoiceToVoid: string | null = null;

  if (existing) {
    // An automatic choice can still be changed while nothing has been paid out and no fee has been paid.
    if (existing.refundedCents > 0 || existing.refundByHandCents > 0 || existing.creditId) {
      throw new Error(
        "Money has already been refunded or credited for this return, so it can't be changed here. Use the refund or credit forms on the customer's account.",
      );
    }
    if (existing.feeInvoiceId) {
      const feeInvoice = await tx.invoice.findUnique({
        where: { id: existing.feeInvoiceId },
        select: { id: true, status: true, amountPaidCents: true },
      });
      if (feeInvoice && (feeInvoice.amountPaidCents > 0 || !["DRAFT", "OPEN", "DELINQUENT", "VOID"].includes(feeInvoice.status))) {
        throw new Error("The early-ending fee has already been paid, so this can't be changed here.");
      }
      if (feeInvoice && feeInvoice.status !== "VOID") feeInvoiceToVoid = feeInvoice.id;
    }
    if (existing.billing === "END_AT_PICKUP" && !plan.endAtPickup) {
      throw new Error("This rental already ended at pickup. Billing can't be started again from here.");
    }
  } else if (agreement.status !== "ACTIVE") {
    throw new Error("Only an active rental has an early return to settle.");
  }

  if (feeInvoiceToVoid) {
    await tx.invoice.update({ where: { id: feeInvoiceToVoid }, data: { status: "VOID", amountDueCents: 0 } });
    await tx.auditLog.create({
      data: {
        userId: actor.userId,
        action: "agreement.early_return_fee_voided",
        entityType: "Invoice",
        entityId: feeInvoiceToVoid,
        newValue: { agreementId: input.agreementId, because: "The early-return choice was changed before the fee was paid." },
      },
    });
  }
  if (plan.undoRecordedEnding) {
    await tx.rentalAgreement.update({
      where: { id: input.agreementId },
      data: { terminationRequestedAt: null, terminationEffectiveOn: null, terminationFeeCents: null, terminationPolicyVersion: null },
    });
    subscriptionEndIds.push(...(await recomputeForAgreementInTx(tx, input.agreementId)));
  }

  let endingRecorded = false;
  let close: CloseAgreementResult | null = null;
  let feeInvoiceId: string | null = null;

  if (plan.record) {
    const effectiveOn = plan.record.kind === "FIXED" ? plan.record.quote.effectiveOn : plan.record.effectiveOn;
    await tx.rentalAgreement.update({
      where: { id: input.agreementId },
      data: {
        terminationRequestedAt: input.pickupDate,
        terminationEffectiveOn: effectiveOn,
        terminationFeeCents: plan.fee.feeCents,
        terminationPolicyVersion: plan.record.kind === "FIXED" ? plan.record.quote.policyVersion : `mtm-v${plan.record.terms.version}`,
      },
    });
    subscriptionEndIds.push(...(await recomputeForAgreementInTx(tx, input.agreementId)));
    endingRecorded = true;
  }

  if (plan.endAtPickup) {
    if (plan.fee.feeCents > 0) {
      const invoice = await tx.invoice.create({
        data: {
          customerId: agreement.customerId,
          agreementId: input.agreementId,
          status: "DRAFT",
          subtotalCents: plan.fee.feeCents,
          taxCents: 0,
          amountDueCents: plan.fee.feeCents,
          dueDate: input.pickupDate,
          lineItems: {
            create: {
              kind: "EARLY_TERMINATION_FEE",
              description: `Early ending fee — equipment returned ${formatBusinessDate(input.pickupDate)}, before the end of its ${agreement.termMonths}-month term`,
              amountCents: plan.fee.feeCents,
              quantity: 1,
            },
          },
        },
      });
      feeInvoiceId = invoice.id;
      const taxResult = await applyLocalInvoiceTaxInTx(tx, {
        invoiceId: invoice.id,
        agreementId: input.agreementId,
        taxDate: input.pickupDate,
        actorUserId: actor.userId,
      });
      await tx.auditLog.create({
        data: {
          userId: actor.userId,
          action: "agreement.termination_fee_invoiced",
          entityType: "Invoice",
          entityId: invoice.id,
          newValue: {
            agreementId: input.agreementId,
            feeCents: plan.fee.feeCents,
            fee: formatCents(plan.fee.feeCents),
            taxCents: taxResult.ok ? taxResult.totalTaxCents : 0,
            taxBlocked: !taxResult.ok,
            earlyReturn: true,
          },
        },
      });
    }
    if (agreement.status === "ACTIVE") {
      close = await closeAgreementInTx(tx, actor.userId, input.agreementId, "ENDED", { endedOn: plan.lastBilledEnd });
    }
  }

  const resolutionData = {
    jobId: input.jobId,
    pickupDate: input.pickupDate,
    billing: plan.choice.billing,
    unusedDays: plan.endAtPickup ? plan.choice.unusedDays : "KEEP",
    unusedDaysCount: plan.preview.unusedDaysCount,
    unusedCents: plan.preview.unusedCents,
    unusedTaxCents: plan.preview.unusedTaxCents,
    feeCents: plan.fee.feeCents,
    feeReason: plan.fee.feeReason,
    feeInvoiceId,
    appliedBy: actor.by,
    decidedByUserId: actor.userId,
  };
  const resolution = existing
    ? await tx.earlyReturnResolution.update({ where: { id: existing.id }, data: resolutionData })
    : await tx.earlyReturnResolution.create({ data: { agreementId: input.agreementId, ...resolutionData } });

  let creditId: string | null = null;
  let refundRuns: RefundAcrossRun[] = [];
  let refundedCents = 0;
  let refundByHandCents = 0;
  if (plan.endAtPickup && plan.preview.refundOrCreditCents > 0) {
    if (plan.choice.unusedDays === "CREDIT") {
      const credit = await tx.customerCredit.create({
        data: {
          customerId: agreement.customerId,
          amountCents: plan.preview.refundOrCreditCents,
          remainingCents: plan.preview.refundOrCreditCents,
          reason: `Credit – equipment returned early – ${plan.preview.unusedDaysCount} unused ${plan.preview.unusedDaysCount === 1 ? "day" : "days"}`,
          notes: `Days after ${formatBusinessDate(plan.preview.lastBilledDay)} that were already paid for.`,
          authorizedByUserId: actor.userId,
          sourceType: "EARLY_RETURN",
          sourceId: resolution.id,
          side: "CUSTOMER",
        },
      });
      creditId = credit.id;
    } else if (plan.choice.unusedDays === "REFUND") {
      if (!actor.userId) throw new Error("A refund needs a signed-in person to record it.");
      const refunded = await refundAcrossPaidInvoicesInTx(tx, actor.userId, {
        agreementId: input.agreementId,
        amountCents: plan.preview.refundOrCreditCents,
        reason: "OTHER",
        notes: `Equipment returned early: ${plan.preview.unusedDaysCount} unused days after ${formatBusinessDate(plan.preview.lastBilledDay)}.`,
      });
      refundRuns = refunded.runs;
      refundedCents = refunded.refundedCents;
      refundByHandCents = refunded.refundByHandCents;
    }
  }
  if (creditId || refundedCents > 0 || refundByHandCents > 0) {
    await tx.earlyReturnResolution.update({ where: { id: resolution.id }, data: { creditId, refundedCents, refundByHandCents } });
  }

  await tx.auditLog.create({
    data: {
      userId: actor.userId,
      action: "agreement.early_return_resolved",
      entityType: "RentalAgreement",
      entityId: input.agreementId,
      newValue: {
        by: actor.by,
        changedFromAutomatic: !!existing,
        choice: { billing: plan.choice.billing, unusedDays: plan.choice.unusedDays, feeCents: plan.fee.feeCents, feeReason: plan.fee.feeReason },
        preview: JSON.parse(serializePreview(plan.preview)),
        endingRecorded,
        feeInvoiceId,
        creditId,
        refundedCents,
        refundByHandCents,
      },
    },
  });

  return { resolutionId: resolution.id, close, refundRuns, creditId, subscriptionEndIds, agreementId: input.agreementId, endingRecorded };
}

/** The parts of an early return that talk to Stripe or clean up after the transaction commits. Failures are logged, never thrown. */
export async function runEarlyReturnContinuation(userId: string | null, applied: EarlyReturnApplied): Promise<void> {
  try {
    if (applied.close) await runCloseAgreementContinuation(applied.close);
    await applySubscriptionEnds(applied.subscriptionEndIds);
  } catch (error) {
    console.error(`Early return of ${applied.agreementId}: could not finish the Stripe side of ending billing yet:`, error);
  }
  for (const run of applied.refundRuns) {
    try {
      await runPreparedInvoiceRefund(run);
    } catch (error) {
      console.error(`Could not send early-return refund ${run.refundId} to Stripe yet:`, error);
    }
  }
  if (applied.endingRecorded) {
    try {
      await cancelWithdrawnAutoRenewals(userId, applied.agreementId);
    } catch (error) {
      console.error(`Could not cancel the automatic renewal of ${applied.agreementId} yet:`, error);
    }
  }
}

/** The owner confirms a choice on the early-return screen. */
export async function applyEarlyReturn(
  userId: string,
  agreementId: string,
  choice: EarlyReturnChoice,
  expectedPreview: EarlyReturnPreview,
): Promise<void> {
  const applied = await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);
    const pickup = await loadReturnPickup(tx, agreementId);
    if (!pickup) throw new Error("No equipment has come back from this rental yet.");
    return applyEarlyReturnInTx(tx, { userId, by: "OWNER" }, { agreementId, jobId: pickup.jobId, pickupDate: pickup.pickupDate, choice, expectedPreview });
  });
  await runEarlyReturnContinuation(userId, applied);
}
