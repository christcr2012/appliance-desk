import type { Prisma } from "@prisma/client";
import { addBusinessDays, businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { dueOnFor, legalDueOn, periodsFor } from "./filing-calendar";
import { explainPendingPurchaseTax } from "./purchase-tax-explain";

/**
 * W-2 / D-WA6 — every purchase-tax answer leads to exactly ONE next step, worded once.
 * The record-a-purchase result card, the appliance page, the purchase page, purchase-order
 * receiving and To do all render the object returned here, so they can never disagree.
 *
 * `nextPurchaseTaxStep` is pure: it only reads the snapshot it is given. Due dates always arrive
 * from the filing calendar (periods already stored, or computed by `filing-calendar.ts`); nothing
 * here hard-codes a date. `loadPurchaseTaxSubjects` builds the snapshots from the database.
 */

export const CHECK_RECEIPT_AFTER_DAYS = 3;
export const URGENT_BEFORE_RETURN_DAYS = 7;

export type PurchaseTaxChoiceName = "SELLER_CHARGED" | "NONE_CHARGED" | "LESSOR_PERMISSION" | "LATER";
export type PurchaseTaxAttentionReason =
  | "PURCHASE_DATE_OR_COST_MISSING"
  | "ELECTION_UNDECIDED"
  | "BUSINESS_ADDRESS_UNVERIFIED"
  | "RATES_UNREVIEWED";

export type CoveringReturn = { name: string; legalDueOn: Date };

export type SubjectUseTaxRow = {
  jurisdictionName: string;
  status: "DUE" | "NOT_DUE" | "FILED";
  useTaxDueCents: number;
  returnName: string | null;
  returnLegalDueOn: Date | null;
  filedOn: Date | null;
  confirmationNumber: string | null;
};

/** One thing a tax answer was recorded for: an appliance, or the parts on one purchase-order receipt. */
export type PurchaseTaxSubject = {
  /** "Washer WASH-0003" or "Parts received on purchase order from Acme". */
  label: string;
  /** The record page that fixes or explains this subject. */
  href: string;
  status: "UNKNOWN" | "SALES_TAX_PAID" | "USE_TAX_DUE" | "USE_TAX_PAID" | "BOUGHT_TAX_FREE_FOR_LEASE";
  choice: PurchaseTaxChoiceName | null;
  /** Another state's name when the receipt showed that state's tax; the CPA decides the credit (IN-65). */
  otherStateName: string | null;
  otherStateTaxCents: number | null;
  /** When the answer (or the purchase) was recorded; the "check the receipt" clock starts here. */
  recordedAt: Date | null;
  purchasedOn: Date | null;
  useTaxRows: SubjectUseTaxRow[];
  /** The use-tax return that covers this purchase date, from the filing calendar. */
  covering: CoveringReturn | null;
  /** Why a recorded answer cannot be turned into use tax yet (business setup missing). */
  blockedReason: PurchaseTaxAttentionReason | null;
  blockedHref: string | null;
  blockedLabel: string | null;
};

export type PurchaseTaxStepKind =
  | "DONE_SELLER_TAX"
  | "USE_TAX_ON_RETURN"
  | "USE_TAX_NO_FILING_ACCOUNT"
  | "USE_TAX_FILED"
  | "NO_USE_TAX_DUE"
  | "RENT_TAXED"
  | "CPA_OTHER_STATE"
  | "CHECK_RECEIPT_LATER"
  | "NEEDS_SETUP";

export type PurchaseTaxStep = {
  kind: PurchaseTaxStepKind;
  headline: string;
  detail: string;
  /** True when nothing is left for Chris to do. */
  done: boolean;
  amountCents: number | null;
  returns: { name: string; dueOn: Date | null; amountCents: number }[];
  /** The dated To do this step creates; null when no new To do is needed (existing rows cover it). */
  todo: null | {
    title: string;
    detail: string;
    severity: "high" | "medium";
    dueOn: Date | null;
    primaryAction: { label: string; href: string };
  };
};

const shortDate = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric",
});
export function stepDate(date: Date): string {
  return shortDate.format(date);
}

function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
}

/**
 * The single shared decision. `now` only matters for urgency of the later-check To do.
 */
export function nextPurchaseTaxStep(subject: PurchaseTaxSubject, now: Date): PurchaseTaxStep {
  const base = { amountCents: null, returns: [] as PurchaseTaxStep["returns"], todo: null };

  if (subject.status === "BOUGHT_TAX_FREE_FOR_LEASE") {
    return {
      ...base, kind: "RENT_TAXED", done: true,
      headline: "Bought tax-free to rent out — customers' rent on this appliance is taxed.",
      detail: "Billing already adds sales tax to this appliance's rent. Nothing to file for the purchase itself.",
    };
  }

  if (subject.status === "UNKNOWN") {
    if (subject.otherStateName) {
      const amount = subject.otherStateTaxCents;
      const state = subject.otherStateName;
      const detail = "Ask your CPA how much Colorado state and city use tax is still owed when " + state +
        " tax was charged" + (amount ? " (" + formatMoney(amount) + " on this purchase)" : "") +
        ". Nothing is calculated for you until that answer is saved as a setting.";
      return {
        ...base, kind: "CPA_OTHER_STATE", done: false,
        headline: "Ask your CPA: tax paid to " + state + ".",
        detail,
        todo: {
          title: "Ask your CPA: tax paid to " + state,
          detail: subject.label + ". " + detail,
          severity: "medium", dueOn: null,
          primaryAction: { label: "Open purchase", href: subject.href },
        },
      };
    }
    if (subject.choice && subject.choice !== "LATER" && subject.blockedReason) {
      const fix = subject.blockedLabel ?? "Finish setup";
      const reason: Record<PurchaseTaxAttentionReason, string> = {
        PURCHASE_DATE_OR_COST_MISSING: "Enter the purchase date and cost so the tax can be worked out.",
        ELECTION_UNDECIDED: "Choose how rental purchase tax is handled, then this purchase can be finished.",
        BUSINESS_ADDRESS_UNVERIFIED: "Confirm your business address so the right tax areas apply.",
        RATES_UNREVIEWED: "Review the tax rates for your areas so use tax can be calculated.",
      };
      return {
        ...base, kind: "NEEDS_SETUP", done: false,
        headline: fix + ".",
        detail: reason[subject.blockedReason],
      };
    }
    // LATER (or never answered): the dated "check the receipt" step.
    const start = subject.recordedAt ?? now;
    const dueOn = addBusinessDays(businessDateFromKey(businessDateKey(start))!, CHECK_RECEIPT_AFTER_DAYS);
    const covering = subject.covering;
    let severity: "high" | "medium" = "medium";
    let answerBy = "";
    if (covering) {
      const urgentFrom = businessDateKey(addBusinessDays(covering.legalDueOn, -URGENT_BEFORE_RETURN_DAYS));
      if (businessDateKey(now) >= urgentFrom) severity = "high";
      answerBy = " Answer by " + stepDate(covering.legalDueOn) + " so your " + covering.name + " is right.";
    }
    const headline = "Check the receipt: did the seller charge tax?" + answerBy;
    return {
      ...base, kind: "CHECK_RECEIPT_LATER", done: false, headline,
      detail: "Open the receipt and tell the app what tax the seller charged. Until then the purchase tax is unknown.",
      todo: {
        title: "Check " + subject.label + "'s receipt: did the seller charge tax?",
        detail: headline,
        severity, dueOn,
        primaryAction: { label: "Answer purchase tax", href: subject.href },
      },
    };
  }

  const dueRows = subject.useTaxRows.filter((row) => row.status === "DUE" && row.useTaxDueCents > 0);
  const filedRows = subject.useTaxRows.filter((row) => row.status === "FILED" && row.useTaxDueCents > 0);

  if (dueRows.length) {
    const total = dueRows.reduce((sum, row) => sum + row.useTaxDueCents, 0);
    const byReturn = new Map<string, { name: string; dueOn: Date | null; amountCents: number }>();
    let unlinked = false;
    for (const row of dueRows) {
      // A DUE row with no stored period yet still belongs on the calendar's covering return.
      if (!row.returnName && subject.covering) {
        const entry = byReturn.get(subject.covering.name) ??
          { name: subject.covering.name, dueOn: subject.covering.legalDueOn, amountCents: 0 };
        entry.amountCents += row.useTaxDueCents;
        byReturn.set(subject.covering.name, entry);
        continue;
      }
      if (!row.returnName) { unlinked = true; continue; }
      const entry = byReturn.get(row.returnName) ??
        { name: row.returnName, dueOn: row.returnLegalDueOn, amountCents: 0 };
      entry.amountCents += row.useTaxDueCents;
      byReturn.set(row.returnName, entry);
    }
    const returns = [...byReturn.values()];
    if (unlinked && !returns.length) {
      return {
        ...base, kind: "USE_TAX_NO_FILING_ACCOUNT", done: false, amountCents: total,
        headline: "Use tax of " + formatMoney(total) + " is owed, but there is no return to put it on yet.",
        detail: "Link the tax area to a use-tax filing account in sales-tax setup so this lands on a return with a due date.",
      };
    }
    const parts = returns.map((entry) =>
      entry.dueOn ? entry.name + " due " + stepDate(entry.dueOn) : entry.name);
    return {
      ...base, kind: "USE_TAX_ON_RETURN", done: false, amountCents: total, returns,
      headline: "Use tax of " + formatMoney(total) + " is included in your " + listNames(parts) + ".",
      detail: "Nothing more to enter here. The filing To do appears when the return is ready" +
        (unlinked ? "; part of the tax still needs a linked filing account." : "."),
    };
  }

  if (filedRows.length) {
    const total = filedRows.reduce((sum, row) => sum + row.useTaxDueCents, 0);
    const first = filedRows[0]!;
    return {
      ...base, kind: "USE_TAX_FILED", done: true, amountCents: total,
      headline: "Use tax of " + formatMoney(total) + " was reported on your " + (first.returnName ?? "return") +
        (first.filedOn ? ", filed " + stepDate(first.filedOn) : "") +
        (first.confirmationNumber ? " (confirmation " + first.confirmationNumber + ")" : "") + ".",
      detail: "The receipt and the filed return are your proof. If this answer changes, an amended return is flagged for you.",
    };
  }

  if (subject.status === "SALES_TAX_PAID") {
    return {
      ...base, kind: "DONE_SELLER_TAX", done: true,
      headline: "Tax was paid to the seller — nothing to file. Keep the receipt as your proof.",
      detail: "Colorado is not sent anything for this purchase; the seller already collected and sent the tax.",
    };
  }

  return {
    ...base, kind: "NO_USE_TAX_DUE", done: true,
    headline: "No use tax is due on this purchase.",
    detail: "The recorded tax covers what is owed at the tax rates in effect on the purchase date.",
  };
}

// ---------------------------------------------------------------------------
// Loading snapshots
// ---------------------------------------------------------------------------

type Client = Prisma.TransactionClient;

/** The earliest use-tax return, from the filing calendar, that covers `purchasedOn` for the business location. */
export async function coveringUseTaxReturn(client: Client, purchasedOn: Date): Promise<CoveringReturn | null> {
  const location = await client.addressTaxLocation.findFirst({
    where: { forBusinessLocation: true, isCurrent: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { jurisdictions: { select: { jurisdiction: { select: { useTaxFilingAccountId: true } } } } },
  });
  const accountIds = [...new Set((location?.jurisdictions ?? [])
    .map((row) => row.jurisdiction.useTaxFilingAccountId).filter((id): id is string => !!id))];
  if (!accountIds.length) return null;
  const accounts = await client.taxFilingAccount.findMany({
    where: { id: { in: accountIds }, active: true, kind: "USE_TAX_RETURN" },
    select: { id: true, name: true, frequency: true, firstPeriodStart: true, dueDayOfFollowingMonth: true },
    orderBy: [{ id: "asc" }],
  });
  const key = businessDateKey(purchasedOn);
  let best: CoveringReturn | null = null;
  for (const account of accounts) {
    let due: Date | null = null;
    const stored = await client.taxFilingPeriod.findFirst({
      where: { filingAccountId: account.id, periodStart: { lte: purchasedOn }, periodEnd: { gte: purchasedOn } },
      select: { dueOn: true, legalDueOn: true },
    });
    if (stored) {
      due = stored.legalDueOn ?? legalDueOn(stored.dueOn);
    } else {
      const range = periodsFor(account, purchasedOn).find((period) =>
        businessDateKey(period.start) <= key && businessDateKey(period.end) >= key);
      if (range) due = legalDueOn(dueOnFor(range.end, account.dueDayOfFollowingMonth));
    }
    if (due && (!best || businessDateKey(due) < businessDateKey(best.legalDueOn))) {
      best = { name: account.name, legalDueOn: due };
    }
  }
  return best;
}

const OTHER_STATE_NOTE = /^Tax paid to (.{1,80}?): /;

/** Appliance snapshots, in the order of `applianceIds` (unknown ids are skipped). */
export async function loadApplianceTaxSubjects(
  client: Client, applianceIds: readonly string[],
): Promise<Map<string, PurchaseTaxSubject>> {
  const result = new Map<string, PurchaseTaxSubject>();
  if (!applianceIds.length) return result;
  const appliances = await client.appliance.findMany({
    where: { id: { in: [...applianceIds] } },
    select: {
      id: true, assetNumber: true, acquisitionTaxStatus: true, acquisitionTaxChoice: true,
      acquisitionSellerNote: true, acquisitionTaxRecordedAt: true, purchaseDate: true, createdAt: true,
      applianceType: { select: { name: true } },
      purchase: { select: { id: true, sellerTaxKind: true, sellerTaxState: true } },
    },
  });
  const rows = await client.purchaseUseTax.findMany({
    where: { sourceType: "APPLIANCE", sourceId: { in: appliances.map((a) => a.id) } },
    select: {
      sourceId: true, status: true, useTaxDueCents: true,
      jurisdiction: { select: { name: true } },
      filingPeriod: {
        select: {
          status: true, dueOn: true, legalDueOn: true, filedOn: true, confirmationNumber: true,
          filingAccount: { select: { name: true } },
        },
      },
    },
    orderBy: [{ jurisdictionId: "asc" }, { id: "asc" }],
  });
  const coveringCache = new Map<string, CoveringReturn | null>();
  for (const appliance of appliances) {
    const purchasedOn = appliance.purchaseDate;
    let covering: CoveringReturn | null = null;
    const rowsFor = rows.filter((row) => row.sourceId === appliance.id);
    if (purchasedOn && (appliance.acquisitionTaxStatus === "UNKNOWN" ||
        rowsFor.some((row) => row.status === "DUE" && !row.filingPeriod))) {
      const cacheKey = businessDateKey(purchasedOn);
      if (!coveringCache.has(cacheKey)) coveringCache.set(cacheKey, await coveringUseTaxReturn(client, purchasedOn));
      covering = coveringCache.get(cacheKey) ?? null;
    }
    const note = appliance.acquisitionSellerNote?.match(OTHER_STATE_NOTE);
    const otherState = appliance.purchase?.sellerTaxKind === "OTHER_STATE"
      ? appliance.purchase.sellerTaxState ?? note?.[1] ?? "another state"
      : note?.[1] ?? null;
    let blocked: Awaited<ReturnType<typeof explainPendingPurchaseTax>> | null = null;
    if (appliance.acquisitionTaxStatus === "UNKNOWN" && appliance.acquisitionTaxChoice &&
        appliance.acquisitionTaxChoice !== "LATER" && !otherState) {
      blocked = await explainPendingPurchaseTax(client, appliance.id);
    }
    result.set(appliance.id, {
      label: appliance.applianceType.name + " " + appliance.assetNumber,
      href: "/desk/inventory/" + appliance.id,
      status: appliance.acquisitionTaxStatus,
      choice: appliance.acquisitionTaxChoice as PurchaseTaxChoiceName | null,
      otherStateName: otherState,
      otherStateTaxCents: null,
      recordedAt: appliance.acquisitionTaxRecordedAt ?? appliance.createdAt,
      purchasedOn,
      covering,
      blockedReason: (blocked?.reason && blocked.reason !== "ANSWER_LATER" ? blocked.reason : null) as PurchaseTaxAttentionReason | null,
      blockedHref: blocked?.fixHref ?? null,
      blockedLabel: blocked?.fixLabel ?? null,
      useTaxRows: rows.filter((row) => row.sourceId === appliance.id).map((row) => ({
        jurisdictionName: row.jurisdiction.name,
        status: row.status,
        useTaxDueCents: row.useTaxDueCents,
        returnName: row.filingPeriod?.filingAccount.name ?? null,
        returnLegalDueOn: row.filingPeriod ? (row.filingPeriod.legalDueOn ?? legalDueOn(row.filingPeriod.dueOn)) : null,
        filedOn: row.filingPeriod?.status === "FILED" ? row.filingPeriod.filedOn : null,
        confirmationNumber: row.filingPeriod?.status === "FILED" ? row.filingPeriod.confirmationNumber : null,
      })),
    });
  }
  return result;
}

export async function loadApplianceTaxSteps(
  client: Client, applianceIds: readonly string[], now = new Date(),
): Promise<Map<string, PurchaseTaxStep & { subject: PurchaseTaxSubject }>> {
  const subjects = await loadApplianceTaxSubjects(client, applianceIds);
  return new Map([...subjects].map(([id, subject]) =>
    [id, { ...nextPurchaseTaxStep(subject, now), subject }]));
}
