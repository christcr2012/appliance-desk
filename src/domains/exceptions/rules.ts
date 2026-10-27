import {
  addBusinessDays,
  businessDateKey,
  businessDayBounds,
  businessDaysBetween,
} from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { shortDateLabel } from "@/domains/tax/file-and-pay";

// ---------------------------------------------------------------------------
// Exception inbox (2026-09-28) — one place that surfaces anything stuck or
// needing Chris's attention, instead of him having to remember to go check
// six different pages. Pure, zero-database-import rules here (same pattern
// as src/domains/inventory/lifecycle.ts, src/domains/agreements/
// reservation-status.ts) so they're simple to unit-test; src/domains/
// exceptions/index.ts is the thin DB wrapper that queries real rows and
// runs them through these.
//
// Every category here is something that was ALREADY possible before this
// file existed (a stuck reservation, a blocked billing start, a past-due
// invoice, a missed job, an unreviewed request, a machine sitting
// uninspected) — this doesn't add new failure states, it just collects the
// existing ones into one list instead of leaving Chris to notice them by
// accident on whichever page he happens to open.
// ---------------------------------------------------------------------------

export type ExceptionCategory =
  | "BOOKS_NOT_UP_TO_DATE"
  | "BOOKS_NEEDS_FIX"
  | "BOOKS_SETUP"
  | "BOOKS_MONTH_REVIEW"
  | "SYSTEM_ISSUE"
  | "BILLING_BLOCKED"
  | "SALES_TAX"
  | "TAX_RETURN_DUE"
  | "TAX_LICENSE_RENEWAL"
  | "TAX_SETUP_CHECK"
  | "BUSINESS_PAPERWORK"
  | "TAX_AMENDMENT_DUE"
  | "TAX_FILING_NOT_READY"
  | "ACQUISITION_TAX_REVIEW"
  | "PURCHASE_USE_TAX_DUE"
  | "RETAIL_DELIVERY_FEE"
  | "STALE_RESERVATION"
  | "PAST_DUE_INVOICE"
  | "BANK_PAYMENT_SLOW"
  | "PAYMENT_DISPUTE"
  | "COLLECTION_STEP"
  | "CONTINUITY"
  | "SETUP_GUIDE"
  | "VAULT"
  | "PRIVACY_DUTY"
  | "LATE_FEE_REVIEW"
  | "DECISIONS_STARTING_VALUES"
  | "HELD_PAYMENT_DECISION"
  | "DEPOSIT_DECISION"
  | "NEW_LEAD_CONTACT"
  | "LEAD_FOLLOW_UP"
  | "COMPLIANCE_DUE"
  | "SUPPLIER_TAX_ID"
  | "APPROVED_QUOTE"
  | "SIGNING_PAYMENT_DUE"
  | "UNSIGNED_AGREEMENT"
  | "CANCELLATION_REFUND_DUE"
  | "SIGNED_DELIVERY_UNSCHEDULED"
  | "RENTAL_ENDING_SOON"
  | "PICKUP_UNSCHEDULED"
  | "RETIRED_APPLIANCE_PLAN"
  | "RECALL_POSSIBLE"
  | "SAFETY_INCIDENT"
  | "RETIRED_SALE_TAX_REVIEW"
  | "VEHICLE_DUE"
  | "INSURANCE_RENEWAL"
  | "APPROVAL_REQUEST"
  | "GOAL_BEHIND"
  | "IDLE_APPLIANCES"
  | "LOW_UTILIZATION"
  | "VISIT_NEEDS_ASSIGNMENT"
  | "CLEANING_NEEDED"
  | "OVERDUE_JOB"
  | "UNREVIEWED_MAINTENANCE_REQUEST"
  | "UNINSPECTED_RETURN"
  | "MISSING_REPAIR_COST"
  | "AGREEMENT_TERM_EXPIRED"
  | "APPLIANCE_MAINTENANCE_DUE"
  | "RENEWAL_NOT_STARTED"
  | "EARLY_ENDING_NOT_DONE"
  | "NOTICE_WAITING"
  | "NOTICE_MISSED"
  | "NOTICE_UNCERTAIN"
  | "NOTICE_FAILED"
  | "ITEM_NOT_DELIVERED"
  | "RETURNED_EARLY"
  | "SUBSCRIPTION_UPDATE_PENDING"
  | "CUSTODY_UNKNOWN"
  | "OLD_SET_APPLIANCE"
  | "OUT_OF_SERVICE"
  | "FEEDBACK_WAITING";

export type ExceptionSeverity = "high" | "medium" | "low";

export type ExceptionItem = {
  category: ExceptionCategory;
  severity: ExceptionSeverity;
  title: string;
  detail: string;
  /** Where "Fix this" should send Chris. */
  href: string;
  /** Optional separate public source link; only HTTPS is surfaced. */
  sourceHref?: string;
  sourceLabel?: string;
  action?:
    | {
        type: "ACK_TAX_SOURCE_CHANGE";
        id: string;
        version: string;
        label: string;
      }
    | {
        type: "UNDO_OFFICIAL_RATE";
        id: string;
        label: string;
      }
    | {
        type: "APPLY_OFFICIAL_RATE";
        id: string;
        label: string;
      }
    | {
        /** TFA-3: approve a stored official-page rule reading (id = the observation row). "Not right" rides alongside in the inbox. */
        type: "APPROVE_RULE_CHANGE";
        id: string;
        label: string;
      }
    | {
        /** TFA-2: approve a prepared delivery-fee switch (id = the switch row). */
        type: "APPROVE_RDF_SWITCH";
        id: string;
        label: string;
      }
    | {
        /** TFA-2 §8: confirm a filing-frequency advice (id = the advice row). */
        type: "CONFIRM_FILING_FREQUENCY";
        id: string;
        label: string;
      }
    | {
        /** BILL-1: record a bank payment Stripe says cleared (id = the in-flight row). */
        type: "RECORD_BANK_PAYMENT";
        id: string;
        label: string;
      };
  /** Real due date only; an issue's creation time is not a deadline. */
  dueOn?: Date;
  dueDateOnly?: boolean;
  /** Outstanding money, in integer cents. */
  amountCents?: number;
  dueLabel?: string;
  primaryAction?: { label: string; href: string };
  todoKey?: string;
  snooze?: { until: Date; reason: string; actorName: string };
  snoozeHistory?: { at: Date; reason: string; until: Date; actorName: string }[];
  /** For sorting oldest-first within a category. */
  since: Date;
  /** AR-0b: how to reach the related customer or lead (Today's Call / Email buttons). */
  contact?: { phone?: string; email?: string };
};

/** AR-0b: a customer's phone and login email as an ExceptionItem contact (blank values left out). */
export function customerContact(customer: { phone?: string | null; user: { email: string } } | null | undefined): ExceptionItem["contact"] {
  if (!customer) return undefined;
  const phone = customer.phone?.trim() || undefined;
  const email = customer.user.email?.trim() || undefined;
  return phone || email ? { ...(phone ? { phone } : {}), ...(email ? { email } : {}) } : undefined;
}

/** AR-0b: a lead's phone and email as an ExceptionItem contact. */
export function leadContact(lead: { phone?: string | null; email?: string | null } | null | undefined): ExceptionItem["contact"] {
  if (!lead) return undefined;
  const phone = lead.phone?.trim() || undefined;
  const email = lead.email?.trim() || undefined;
  return phone || email ? { ...(phone ? { phone } : {}), ...(email ? { email } : {}) } : undefined;
}

// Thresholds — deliberately simple, explainable numbers (docs/BUSINESS-
// RULES.md's lead-scoring section sets the same expectation for any rule
// like this: no hidden math, a number Chris could recite back). Not tied
// to BusinessSettings since these are about Chris's own workflow, not a
// customer-facing policy like lateFeeGraceDays.
export const UNREVIEWED_MAINTENANCE_REQUEST_DAYS = 0;
export const UNINSPECTED_RETURN_DAYS = 3;
// How long a rental whose early return was settled by the owner's standard choices stays on Today for a second look.
export const EARLY_RETURN_DEFAULTS_REVIEW_DAYS = 14;
// Automation rules (Task #67, docs/DECISIONS.md 2026-09-28, Chris's pick
// of the three most useful checks to run automatically). 180 days (~6
// months) is a simple, explainable "it's been a while" bar for a rented
// appliance with no logged maintenance visit — not a manufacturer service
// schedule, since none is tracked per appliance type today.
export const APPLIANCE_MAINTENANCE_DUE_DAYS = 180;

export function invoiceTaxBlockedException(invoice: {
  id: string;
  invoiceNumber: number;
  customerId: string;
  customerName: string;
  since: Date;
  problems: string[];
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "high",
    title: `Bill #${invoice.invoiceNumber} needs a tax decision before it can be sent`,
    detail:
      invoice.problems.length > 0
        ? invoice.problems.join(" ")
        : "Finish the sales-tax setup for this address, then recalculate tax on the bill.",
    href: `/desk/billing/customer/${invoice.customerId}/invoice/${invoice.id}`,
    since: invoice.since,
  };
}

export function stripeTaxMismatchException(invoice: {
  id: string;
  invoiceNumber: number;
  customerId: string;
  customerName: string;
  since: Date;
  stripeTaxCents: number;
  engineTaxCents: number;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "high",
    title: `Bill #${invoice.invoiceNumber} has a Stripe tax mismatch`,
    detail:
      `Stripe recorded ${invoice.stripeTaxCents} cents of tax, while Appliance Desk expected ${invoice.engineTaxCents} cents. Review the bill before relying on it for filing or a refund.`,
    href: `/desk/billing/customer/${invoice.customerId}/invoice/${invoice.id}`,
    since: invoice.since,
  };
}

export function stripeTaxUnverifiedException(invoice: {
  id: string;
  invoiceNumber: number;
  customerId: string;
  customerName: string;
  since: Date;
  problems: string[];
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "high",
    title: `Bill #${invoice.invoiceNumber} tax could not be verified`,
    detail:
      invoice.problems.length > 0
        ? invoice.problems.join(" ")
        : "Review this Stripe bill's tax evidence before relying on it for filing or a refund.",
    href: `/desk/billing/customer/${invoice.customerId}/invoice/${invoice.id}`,
    since: invoice.since,
  };
}

export function taxExemptionExpiryWindow(now: Date): {
  from: Date;
  throughExclusive: Date;
} {
  return {
    from: now,
    throughExclusive: businessDayBounds(addBusinessDays(now, 30)).end,
  };
}

export function taxExemptionWarningSince(expiresOn: Date): Date {
  return businessDayBounds(addBusinessDays(expiresOn, -30)).start;
}

export function taxExemptionExpiryException(exemption: {
  customerId: string;
  customerName: string;
  expiresOn: Date;
  warningSince: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `${exemption.customerName}'s tax exemption expires soon`,
    detail: `The exemption expires ${exemption.expiresOn
      .toISOString()
      .slice(0, 10)}. Review or replace the certificate before it expires.`,
    href: `/desk/customers/${exemption.customerId}?tab=billing`,
    since: exemption.warningSince,
  };
}

export function taxAddressChangedException(address: {
  customerId: string;
  customerName: string;
  addressLabel: string;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "high",
    title: `Tax areas changed for ${address.customerName}`,
    detail: `${address.addressLabel} now resolves to different tax jurisdictions. Review and confirm the address before relying on the new tax areas.`,
    href: "/desk/sales-tax/areas?status=REVIEW",
    since: address.since,
  };
}

export function taxRateReviewReminderException(input: {
  nextEffectiveDateLabel: "January 1" | "July 1";
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Check Colorado tax-rate changes for ${input.nextEffectiveDateLabel}`,
    detail:
      "Review Colorado's local rate-change list and enter any new rates that affect the areas you serve.",
    href: "/desk/sales-tax/taxability",
    since: input.since,
  };
}

function httpsSourceHref(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function taxSourceChangedException(input: {
  id: string;
  version: string;
  label: string;
  excerpt: string | null;
  url: string;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Colorado updated ${input.label} — here is what's new`,
    detail:
      input.excerpt?.trim() ||
      "The official page changed. Review the source; Appliance Desk did not interpret the change as a tax rule or rate change.",
    href: "/desk/sales-tax/areas#sources",
    sourceHref: httpsSourceHref(input.url),
    sourceLabel: "Open official source",
    action: {
      type: "ACK_TAX_SOURCE_CHANGE",
      id: input.id,
      version: input.version,
      label: "I looked at it",
    },
    since: input.since,
  };
}

function milliPercentLabel(value: number | null): string {
  return value === null ? "unknown" : `${(value / 1000).toFixed(3)}%`;
}

function officialRateReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    AUTO_APPLY_DISABLED: "automatic official-rate changes are turned off",
    GREELEY_ALWAYS_REVIEWED: "Greeley's own rate always waits for your approval",
    DELTA_EXCEEDS_LIMIT: "the rate jump exceeds your automatic-change limit",
    EFFECTIVE_DATE_CONFLICT: "another rate already uses that effective date",
    JURISDICTION_NOT_REVIEWED: "the tax jurisdiction has not been reviewed",
    NO_CURRENT_RATE: "there is no reviewed current rate to compare against",
  };
  return labels[reason] ?? reason.toLowerCase().replaceAll("_", " ");
}

export function officialRateScheduledException(input: {
  rateVersionId: string;
  jurisdictionName: string;
  oldRateMilliPercent: number | null;
  newRateMilliPercent: number;
  effectiveFrom: Date;
  since: Date;
  undoAllowed: boolean;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: "Official tax rate scheduled",
    detail: `${input.jurisdictionName}: ${milliPercentLabel(
      input.oldRateMilliPercent,
    )} → ${milliPercentLabel(input.newRateMilliPercent)} effective ${businessDateKey(
      input.effectiveFrom,
    )} · Colorado official lookup`,
    href: "/desk/sales-tax/areas#rates",
    ...(input.undoAllowed
      ? {
          action: {
            type: "UNDO_OFFICIAL_RATE" as const,
            id: input.rateVersionId,
            label: "Undo",
          },
        }
      : {}),
    since: input.since,
  };
}

/**
 * TFA-3 section 14: a stored official-page reading that differs from the
 * rule book, waiting for the owner's approval. The detail carries the
 * page evidence, how sure the app is, and what approving will change.
 * Once the stated start date passes unapproved the item turns high
 * severity; nothing is ever applied on its own.
 */
export function ruleChangeReviewException(input: {
  observationId: string;
  ruleTitle: string;
  describedValue: string;
  ruleKey: string;
  effectiveFrom: Date | null;
  evidence: string;
  watchUrl: string;
  readOnTwoDays: boolean;
  plausible: boolean;
  startPassed: boolean;
  since: Date;
  now: Date;
}): ExceptionItem {
  const dateLabel = input.effectiveFrom ? businessDateKey(input.effectiveFrom) : null;
  const confidence = input.readOnTwoDays
    ? "Read the same way on 2 days."
    : "Read once — check the page.";
  const plausibility = input.plausible
    ? "Within the usual range."
    : "Unusually large change — check carefully.";
  const effect = input.ruleKey === "co.rdf.amount" && dateLabel
    ? `New delivered sales from ${dateLabel} get ${input.describedValue}.`
    : dateLabel
      ? `From ${dateLabel}, this becomes ${input.describedValue}.`
      : "The page states no start date, so this cannot be approved until the city states one.";
  const late = input.startPassed && dateLabel
    ? ` The new amount started on ${dateLabel} — approve it so your records are right.`
    : "";
  return {
    category: "SALES_TAX",
    severity: input.startPassed ? "high" : "medium",
    title: dateLabel
      ? `${input.ruleTitle}: the official page now says ${input.describedValue} from ${dateLabel}`
      : `${input.ruleTitle}: the official page now says ${input.describedValue}`,
    detail: `${input.evidence.slice(0, 300)} ${confidence} ${plausibility} ${effect}${late}`,
    href: "/desk/sales-tax/rules",
    ...(input.watchUrl ? { sourceHref: input.watchUrl, sourceLabel: "Official page" } : {}),
    ...(dateLabel
      ? {
          action: {
            type: "APPROVE_RULE_CHANGE" as const,
            id: input.observationId,
            label: "Approve",
          },
          dueOn: input.effectiveFrom!,
          dueDateOnly: true,
        }
      : {}),
    todoKey: `rule-change-review:${input.observationId}`,
    since: input.since,
  };
}

/**
 * FEETAX-2 section 9: a place a real delivery address needs is not set
 * up yet. The detail walks the owner through getting ready; the setup
 * itself happens on Taxes > Delivery area, so this item is link-only.
 */
export function deliveryReadinessException(input: {
  jurisdictionId: string;
  name: string;
  problems: string[];
  sourceUrl: string | null;
  filesThrough: string;
  licenseRequired: string;
  since: Date;
}): ExceptionItem {
  const filing =
    input.filesThrough === "SUTS"
      ? "Returns for this place are filed through SUTS."
      : input.filesThrough === "CITY_PORTAL"
        ? "Returns for this place are filed on the city's own portal."
        : input.filesThrough === "STATE_RETURN"
          ? "Returns for this place are filed on the state return."
          : "How returns are filed for this place is not recorded yet.";
  const licenseStep =
    input.licenseRequired === "ALWAYS"
      ? " The city requires a license before delivering there. Getting one can cost money — that choice is yours."
      : input.licenseRequired === "AFTER_FIRST_DELIVERY"
        ? " The city requires a license after the first delivery there."
        : input.licenseRequired === "AFTER_SECOND_DELIVERY_IN_12_MONTHS"
          ? " The city requires a license once you deliver there more than once in 12 months."
          : input.licenseRequired === "UNKNOWN"
            ? " Whether the city requires a license is not checked yet — its own page is the source."
            : "";
  return {
    category: "SALES_TAX",
    severity: "high",
    title: `Get ready to deliver in ${input.name}`,
    detail: `${input.problems.join(" ")}${licenseStep} ${filing} When the setup is done, add any license in Business records and link it on Taxes > Delivery area, then mark the place reviewed there.`,
    href: "/desk/sales-tax/area",
    ...(input.sourceUrl
      ? { sourceHref: input.sourceUrl, sourceLabel: "City page" }
      : {}),
    todoKey: `delivery-readiness:${input.jurisdictionId}`,
    since: input.since,
  };
}

/** TAXBEN-1: the written capitalization policy needs the owner's signature. */
export function capitalizationPolicyException(input: {
  year: number;
  renewal: boolean;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Sign the ${input.year} capitalization policy`,
    detail: input.renewal
      ? `The de minimis safe harbor needs a written capitalization policy in place from the start of ${input.year}. The ${input.year} policy is ready to read and sign on Taxes > Tax benefits — signing takes a moment and stores it in Business records.`
      : `The de minimis safe harbor needs a written capitalization policy in place for ${input.year}, and it is not signed yet. It is ready to read and sign on Taxes > Tax benefits — signing stores it in Business records.`,
    href: "/desk/sales-tax/benefits",
    todoKey: `taxben-policy:${input.year}`,
    since: input.since,
  };
}

/** TAXBEN-1: last-quarter buying is pushing the year over the mid-quarter line. */
export function midQuarterWarningException(input: {
  year: number;
  sharePercent: number;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Equipment buying is bunching into the end of ${input.year}`,
    detail: `${input.sharePercent}% of this year's depreciable equipment has been placed in service in the last three months. Past the mid-quarter line, first-year depreciation shrinks. Before buying more this year, see Taxes > Tax benefits and talk to your CPA.`,
    href: "/desk/sales-tax/benefits",
    todoKey: `taxben-mid-quarter:${input.year}`,
    since: input.since,
  };
}

/** TAXBEN-1: the January–March window to compare retirement plans for last year. */
export function retirementComparisonException(input: {
  year: number;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Compare retirement plans for ${input.year - 1} before the deadlines`,
    detail: `January to March is the window: a SEP-IRA for ${input.year - 1} can still be set up and funded up to the filing deadline, while a first-year solo 401(k) has an earlier setup deadline. Taxes > Tax benefits shows both estimates side by side — your CPA confirms which fits.`,
    href: "/desk/sales-tax/benefits",
    todoKey: `taxben-retirement:${input.year}`,
    since: input.since,
  };
}

/** TAXBEN-1: enterprise-zone purchases must be pre-certified before buying. */
export function enterpriseZonePrecertifyException(input: {
  year: number;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Pre-certify enterprise-zone equipment buys for ${input.year}`,
    detail: `The business is inside a Colorado enterprise zone. Equipment bought for use in the zone can earn a state credit — but only when the purchase is pre-certified before you buy. Do this before this year's first equipment purchase.`,
    href: "/desk/sales-tax/benefits",
    todoKey: `taxben-enterprise-zone:${input.year}`,
    since: input.since,
  };
}

/** TAXBEN-1: a shared bill deducts 0% until the owner answers its business-use share. */
export function businessUsePercentException(input: {
  year: number;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: "Answer the business-use share of your shared bills",
    detail: "Accounts you share between business and personal use — phone and internet — deduct 0% until you answer what share is business. Answer once in Write-off settings on Taxes > Tax benefits; the app remembers it.",
    href: "/desk/sales-tax/benefits",
    todoKey: `taxben-business-use:${input.year}`,
    since: input.since,
  };
}

export function officialRateReviewException(input: {
  observationId: string;
  jurisdictionName: string;
  oldRateMilliPercent: number | null;
  newRateMilliPercent: number;
  effectiveFrom: Date;
  reasons: string[];
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "high",
    title: "Official rate needs review",
    detail: `${input.jurisdictionName}: ${milliPercentLabel(
      input.oldRateMilliPercent,
    )} → ${milliPercentLabel(input.newRateMilliPercent)} effective ${businessDateKey(
      input.effectiveFrom,
    )}. Review needed because ${input.reasons
      .map(officialRateReasonLabel)
      .join("; ")}.`,
    href: "/desk/sales-tax/areas#rates",
    action: {
      type: "APPLY_OFFICIAL_RATE",
      id: input.observationId,
      label: "Apply this rate",
    },
    since: input.since,
  };
}

/** TFA-2 §6.3: a delivery-fee switch the app prepared and dated, waiting for the owner's approval. */
export function rdfSwitchException(input: {
  switchId: string;
  kind: "START" | "STOP";
  startsOn: Date;
  basisRetailCents: number | null;
  since: Date;
  now: Date;
}): ExceptionItem {
  const startsKey = businessDateKey(input.startsOn);
  // Spec §6.3: if the date arrives unapproved, the item turns high severity.
  const due = input.startsOn.getTime() <= input.now.getTime();
  const basis = input.basisRetailCents != null
    ? ` Last year's Colorado retail sales were ${formatMoney(input.basisRetailCents)}.`
    : "";
  return {
    category: "SALES_TAX",
    severity: due ? "high" : "medium",
    title: input.kind === "START"
      ? `Delivery fee turns on ${startsKey}`
      : `Delivery fee turns off ${startsKey}`,
    detail: input.kind === "START"
      ? `The retail delivery fee starts on ${startsKey}.${basis} Until you approve, the fee is owed but not billed to customers.${due ? " The law requires the fee from this date, so approve as soon as you can." : ""}`
      : `The retail delivery fee stops on ${startsKey}.${basis} It stays on bills dated before ${startsKey}.`,
    href: "/desk/sales-tax/setup#fee",
    action: {
      type: "APPROVE_RDF_SWITCH",
      id: input.switchId,
      label: input.kind === "START" ? "Approve: fee on" : "Approve: fee off",
    },
    since: input.since,
  };
}

/** TFA-2 §8: filing-frequency advice from the trailing-12-month average. */
export function filingFrequencyAdviceException(input: {
  adviceId: string;
  accountName: string;
  currentFrequency: "ANNUAL" | "QUARTERLY" | "MONTHLY";
  advisedFrequency: "ANNUAL" | "QUARTERLY" | "MONTHLY";
  averageMonthlyCents: number;
  since: Date;
}): ExceptionItem {
  const rank = { ANNUAL: 1, QUARTERLY: 2, MONTHLY: 3 } as const;
  const word = { ANNUAL: "yearly", QUARTERLY: "quarterly", MONTHLY: "monthly" } as const;
  const lessOften = rank[input.advisedFrequency] < rank[input.currentFrequency];
  const average = formatMoney(input.averageMonthlyCents);
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: lessOften
      ? `You may file ${word[input.advisedFrequency]}: ${input.accountName}`
      : `Colorado may move you to ${word[input.advisedFrequency]} on Jan 1: ${input.accountName}`,
    detail: lessOften
      ? `State and state-collected tax for ${input.accountName} averaged ${average} a month over the last 12 months, under the ${word[input.advisedFrequency]} limit. Colorado has to agree before you switch: in Revenue Online, ask to change this account's filing frequency. Then confirm here and future returns use the new schedule.`
      : `State and state-collected tax for ${input.accountName} averaged ${average} a month over the last 12 months, over the limit for ${word[input.currentFrequency]} filing. Colorado may move this account to ${word[input.advisedFrequency]} filing on Jan 1. Check Revenue Online; if Colorado moved you, confirm here so future returns use the new schedule. If Colorado kept your current frequency, snooze this instead.`,
    href: "/desk/sales-tax/setup#accounts",
    todoKey: `filing-frequency-advice:${input.adviceId}`,
    action: {
      type: "CONFIRM_FILING_FREQUENCY",
      id: input.adviceId,
      label: `Confirm: file ${word[input.advisedFrequency]}`,
    },
    since: input.since,
  };
}

/** TFA-2 §7: the January 1 use-tax reset, shown until it is old news or the year switches to monthly. */
export function useTaxResetException(input: {
  accountId: string;
  accountName: string;
  year: string;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `Use tax is back to one yearly return for ${input.year}`,
    detail: `${input.accountName}: Colorado consumer use tax starts each year as one yearly return, due Jan 20 next year. It switches to monthly only if this year's use tax passes the limit.`,
    href: "/desk/sales-tax/setup#accounts",
    todoKey: `use-tax-reset:${input.accountId}:${input.year}`,
    since: input.since,
  };
}

/** TFA-2 §9: a certificate expired and the customer has been billed (so taxed) since. */
export function expiredExemptionException(input: {
  customerId: string;
  customerName: string;
  expiresOn: Date;
  contact?: ExceptionItem["contact"];
}): ExceptionItem {
  const expiredOn = businessDateKey(input.expiresOn);
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `${input.customerName}'s exemption certificate expired on ${expiredOn}`,
    detail: `Bills since then charge tax again. Ask for a new one (Colorado form DR 0715 or DR 5002, or the multistate MTC form). Draft message: "Hi, this is Robinson Appliance Rentals. The tax-exemption certificate we have on file for you expired on ${expiredOn}, so recent bills include sales tax. Please send a current certificate and we will credit the tax charged since the new one took effect." Send it only through the customer's usual email or text switch.`,
    href: `/desk/customers/${input.customerId}?tab=billing`,
    todoKey: `exemption-expired:${input.customerId}:${expiredOn}`,
    contact: input.contact,
    since: input.expiresOn,
  };
}

export function taxSourceUnreachableException(input: {
  label: string;
  url: string;
  since: Date;
}): ExceptionItem {
  return {
    category: "SALES_TAX",
    severity: "medium",
    title: `We couldn't check ${input.label} — the page may have moved`,
    detail:
      "The automatic check has failed at least three times. Verify the official page before relying on this source.",
    href: "/desk/sales-tax/areas#sources",
    sourceHref: httpsSourceHref(input.url),
    sourceLabel: "Open official source",
    since: input.since,
  };
}

export function billingBlockedException(agreement: {
  id: string;
  billingBlockedReason: string;
  updatedAt: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "BILLING_BLOCKED",
    severity: "high",
    title: `Billing couldn't start for ${agreement.customerName}`,
    detail: agreement.billingBlockedReason,
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.updatedAt,
  };
}

/** A signed renewal whose start date passed over a day ago but that has not started (the nightly job could not start it). */
export const RENEWAL_START_GRACE_DAYS = 1;

export function renewalNotStartedException(agreement: {
  id: string;
  startDate: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "RENEWAL_NOT_STARTED",
    severity: "high",
    title: `${agreement.customerName}'s renewal did not start on its start date`,
    detail:
      "The renewal is signed but could not take over from the rental it renews (that rental may have been ended or cancelled early). Open it to cancel or fix it.",
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.startDate,
  };
}

/**
 * An agreement item was not on the delivery visit that started billing and is
 * still waiting (owner decision IN-26). The customer is being billed for it, so
 * it must never be forgotten: schedule a delivery job for it, and when that job
 * is completed the credit for the missing days is worked out automatically.
 */
export function itemNotDeliveredException(item: {
  originalJobId: string;
  itemLabel: string;
  originalDeliveryDate: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "ITEM_NOT_DELIVERED",
    severity: "high",
    title: `${item.itemLabel} has not been delivered to ${item.customerName} yet`,
    detail:
      "The customer is billed for it from the original delivery date. Schedule a delivery job for it; completing that job credits the customer for the days it was missing.",
    href: `/desk/jobs/${item.originalJobId}`,
    since: item.originalDeliveryDate,
  };
}

/**
 * Everything came back before the agreed ending (docs/archive/designs-completed/BATCH-B2.md B2-19). Until the owner chooses, billing
 * carries on; with "apply my defaults" the choice was already made and can still be changed for a short while.
 */
export function returnedEarlyException(item: {
  agreementId: string;
  customerName: string;
  since: Date;
  settled: boolean;
}): ExceptionItem {
  return {
    category: "RETURNED_EARLY",
    severity: item.settled ? "medium" : "high",
    title: item.settled
      ? `${item.customerName}'s equipment came back early — your standard choices were applied`
      : `${item.customerName}'s equipment came back early — choose what to do`,
    detail: item.settled
      ? "Check what was done. You can still change it while no money has been refunded or credited and no fee has been paid."
      : "Billing continues until you decide. Choose whether billing stops now or runs to the agreed ending, what happens to days already paid for, and whether an early-ending fee applies.",
    href: `/desk/agreements/${item.agreementId}/early-return`,
    since: item.since,
  };
}

/**
 * An item was cancelled (never delivered, taken off the agreement) but Stripe has not yet lowered the
 * customer's monthly subscription. The system keeps retrying; this keeps the owner aware until it is done.
 */
export function subscriptionUpdatePendingException(item: {
  originalJobId: string;
  itemLabel: string;
  customerName: string;
  since: Date;
}): ExceptionItem {
  return {
    category: "SUBSCRIPTION_UPDATE_PENDING",
    severity: "high",
    title: `${item.customerName}'s monthly bill has not been lowered yet for cancelled ${item.itemLabel}`,
    detail:
      "The item was cancelled and the customer was credited, but Stripe still has the old monthly amount. The system keeps retrying and the Billing check screen shows it until it is done.",
    href: `/desk/jobs/${item.originalJobId}`,
    since: item.since,
  };
}

/**
 * An appliance is marked as out with a customer (or waiting to be picked up) but the system cannot tell
 * which customer has it. The owner records who has it (a manual custody entry) on the appliance page.
 */
export function custodyUnknownException(appliance: { id: string; label: string; since: Date }): ExceptionItem {
  return {
    category: "CUSTODY_UNKNOWN",
    severity: "medium",
    title: `We don't know which customer has ${appliance.label}`,
    detail:
      "It is marked as rented, but no delivery record says who has it. Open it and record which customer it is with, so pickups and repairs can find it.",
    href: `/desk/inventory/${appliance.id}`,
    since: appliance.since,
  };
}

/** An agreed early-ending date passed but the rental is still active (prepaid months to settle, or the nightly job could not end it). */
export function earlyEndingNotDoneException(agreement: {
  id: string;
  terminationEffectiveOn: Date;
  customerName: string;
  prepaid: boolean;
}): ExceptionItem {
  return {
    category: "EARLY_ENDING_NOT_DONE",
    severity: "high",
    title: `${agreement.customerName}'s early ending has not been carried out`,
    detail: agreement.prepaid
      ? "This rental was paid in advance, so the unused months need your decision (refund, credit or keep) before it can end. Open it to settle that and end the rental."
      : "The agreed ending date has passed but the rental is still active. Open it to end it.",
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.terminationEffectiveOn,
  };
}

/** A message the customer is owed that has not been delivered (live email is off, or the owner has not marked it sent). */
export function noticeWaitingException(notice: {
  id: string;
  customerName: string;
  createdAt: Date;
  kind?: string;
}): ExceptionItem {
  if (notice.kind === "ANNUAL_REMINDER" || notice.kind === "TERMS_CHANGE") {
    return {
      category: "NOTICE_WAITING",
      severity: "high",
      title: `${notice.customerName} has ${notice.kind === "ANNUAL_REMINDER" ? "a yearly reminder" : "a notice about changed terms"} waiting to be sent`,
      detail:
        "Billing is not affected. Send it yourself and mark it as delivered, or turn on live customer email.",
      href: "/desk/notices",
      since: notice.createdAt,
    };
  }
  return {
    category: "NOTICE_WAITING",
    severity: "high",
    title: `${notice.customerName} has a renewal reminder waiting to be sent`,
    detail:
      "Their automatic renewal will not start until this reminder is delivered. Send it yourself and mark it as delivered, or turn on live customer email.",
    href: "/desk/notices",
    since: notice.createdAt,
  };
}

/**
 * A reminder that did not reach the customer cleanly. All three open the same "Fix a missed reminder" screen,
 * which offers every option (docs/archive/designs-completed/BATCH-B2.md B2-18).
 */
export function noticeProblemException(
  status: "MISSED" | "UNCERTAIN" | "FAILED",
  notice: { id: string; customerName: string; createdAt: Date; kind?: string },
): ExceptionItem {
  const label =
    notice.kind === "ANNUAL_REMINDER" ? "yearly reminder" : notice.kind === "TERMS_CHANGE" ? "notice about changed terms" : "renewal reminder";
  const copy = {
    MISSED: {
      category: "NOTICE_MISSED" as const,
      title: `${notice.customerName}'s ${label} was not delivered in time`,
      detail:
        notice.kind === "ANNUAL_REMINDER" || notice.kind === "TERMS_CHANGE"
          ? "The last day to send it passed, so it will not be sent now. Billing carries on as normal. Open it to record that you delivered it another way, or to leave it."
          : "The last day to send it passed. It will never be sent now (it would promise a renewal that cannot start), the automatic renewal will not start on its own, and billing ends on the current end date. Open it to choose what happens next.",
    },
    UNCERTAIN: {
      category: "NOTICE_UNCERTAIN" as const,
      title: `${notice.customerName}'s ${label} may or may not have gone out`,
      detail:
        "The email service did not give a clear answer. Check whether it was delivered, then say so on the next screen. Nothing is sent again by itself.",
    },
    FAILED: {
      category: "NOTICE_FAILED" as const,
      title: `${notice.customerName}'s ${label} was refused three times`,
      detail:
        "The email service refused it every time (often a wrong email address). Fix the address and try again, or deliver it another way.",
    },
  }[status];
  return {
    category: copy.category,
    severity: "high",
    title: copy.title,
    detail: copy.detail,
    href: `/desk/notices/${notice.id}/resolve`,
    since: notice.createdAt,
  };
}

export function staleReservationException(agreement: {
  id: string;
  reservationExpiresAt: Date;
  customerName: string;
}): ExceptionItem {
  return {
    category: "STALE_RESERVATION",
    severity: "medium",
    title: `${agreement.customerName}'s reservation hold has expired`,
    detail:
      "This draft is holding equipment that could go to someone else — sign it, extend the hold, or cancel it.",
    href: `/desk/agreements/${agreement.id}`,
    dueOn: agreement.reservationExpiresAt,
    since: agreement.reservationExpiresAt,
  };
}

export function pastDueInvoiceException(invoice: {
  id: string;
  customerId: string;
  customerName: string;
  status?: string;
  dueDate: Date | null;
  attentionAt?: Date;
  amountDueCents: number;
  amountPaidCents: number;
}): ExceptionItem {
  const owedCents = Math.max(0, invoice.amountDueCents - invoice.amountPaidCents);
  const status = invoice.status ?? "OPEN";
  const reason = status === "DELINQUENT"
    ? "Payment didn't go through"
    : status === "PARTIALLY_PAID"
      ? "Partially paid"
      : "Past due";
  const dateDetail = invoice.dueDate
    ? `, due ${invoice.dueDate.toLocaleDateString("en-US")}`
    : "";
  return {
    category: "PAST_DUE_INVOICE",
    severity: "high",
    title: status === "DELINQUENT"
      ? `${invoice.customerName}'s payment failed — $${(owedCents / 100).toFixed(2)}`
      : `${invoice.customerName}: ${reason.toLowerCase()}`,
    detail: `$${(owedCents / 100).toFixed(2)} still owed${dateDetail}.`,
    href: `/desk/billing/customer/${invoice.customerId}/invoice/${invoice.id}`,
    dueOn: invoice.dueDate ?? undefined,
    dueDateOnly: true,
    amountCents: owedCents,
    since: invoice.dueDate ?? invoice.attentionAt ?? new Date(),
  };
}

/**
 * BILL-1: a bank payment that is taking longer than the owner's number of banking days, or that Stripe says cleared
 * while our books do not show it. Never says the customer is late: the customer paid.
 */
export function bankPaymentSlowException(row: {
  id: string;
  customerId: string | null;
  invoiceId: string | null;
  customerName: string;
  amountCents: number;
  startedAt: Date;
  bankingDaysOld: number;
  settledInStripeAt: Date | null;
}): ExceptionItem {
  const amount = `$${(row.amountCents / 100).toFixed(2)}`;
  const settled = row.settledInStripeAt !== null;
  return {
    category: "BANK_PAYMENT_SLOW",
    severity: settled ? "high" : "medium",
    title: settled
      ? `${row.customerName}'s bank payment cleared but isn't recorded — ${amount}`
      : `${row.customerName}'s bank payment is taking a while — ${amount}`,
    detail: settled
      ? "Stripe says this payment arrived, but it isn't on the bill yet. Use “Record it now”."
      : `The bank has been confirming this payment for ${row.bankingDaysOld} banking days. Nothing is lost; banks usually take up to 4. Check Stripe if it keeps waiting.`,
    // The row id in the link gives each payment its own To do identity (snoozing one never hides another).
    href: `/desk/billing/reconciliation?payment=${encodeURIComponent(row.id)}`,
    amountCents: row.amountCents,
    since: row.startedAt,
    ...(settled ? { action: { type: "RECORD_BANK_PAYMENT" as const, id: row.id, label: "Record it now" } } : {}),
  };
}

/**
 * FEE-1: an overdue bill that has no late fee because the customer was never warned (or is active military).
 * A fee needs a warning first; Chris chooses what happens next on the bill page.
 */
export function lateFeeReviewException(row: {
  invoiceId: string;
  customerId: string;
  customerName: string;
  invoiceNumber: number;
  reason: "NOT_WARNED" | "MILITARY";
  dueOn: Date | null;
  amountCents: number;
}): ExceptionItem {
  return {
    category: "LATE_FEE_REVIEW",
    severity: "medium",
    title: row.reason === "MILITARY"
      ? `No automatic late fee for ${row.customerName} — active military`
      : `No late fee for ${row.customerName} — they weren't warned yet`,
    detail: row.reason === "MILITARY"
      ? `Bill #${row.invoiceNumber} is past the day a fee could be added. You decide whether to skip it.`
      : `Bill #${row.invoiceNumber} is past the day a fee could be added, but the warning was never delivered. Send the warning, record a phone call, or skip the fee.`,
    href: `/desk/billing/customer/${encodeURIComponent(row.customerId)}/invoice/${encodeURIComponent(row.invoiceId)}`,
    amountCents: row.amountCents,
    since: row.dueOn ?? new Date(0),
    ...(row.dueOn ? { dueOn: row.dueOn, dueDateOnly: true } : {}),
  };
}

/** DEC-2: researched starting values now run the app; the owner reviews them or sends the tax ones to the CPA. */
export function startingValuesAppliedException(input: { count: number; newest: Date }): ExceptionItem {
  return {
    category: "DECISIONS_STARTING_VALUES",
    severity: "medium",
    title: `${input.count} starting value${input.count === 1 ? " is" : "s are"} now in use`,
    detail: "Researched answers for tax and rental questions. Review them, or send the tax ones to your CPA.",
    href: "/desk/settings/decisions?state=starting_value",
    since: input.newest,
  };
}

export function overdueJobException(job: {
  id: string;
  type: string;
  scheduledAt: Date;
  customerName: string | null;
}): ExceptionItem {
  return {
    category: "OVERDUE_JOB",
    severity: "medium",
    title: `${job.type.replace(/_/g, " ").toLowerCase()} job is overdue`,
    detail: `Scheduled for ${job.scheduledAt.toLocaleDateString("en-US")}${job.customerName ? ` (${job.customerName})` : ""} but never marked in progress or completed.`,
    href: `/desk/jobs/${job.id}`,
    dueOn: job.scheduledAt,
    since: job.scheduledAt,
  };
}

export function unreviewedMaintenanceRequestException(request: {
  id: string;
  openedAt: Date;
  customerName: string;
  problem: string;
}): ExceptionItem {
  return {
    category: "UNREVIEWED_MAINTENANCE_REQUEST",
    severity: "medium",
    title: `Review ${request.customerName}'s repair request`,
    detail: request.problem,
    href: `/desk/maintenance/${request.id}`,
    since: request.openedAt,
  };
}

export function uninspectedReturnException(appliance: {
  id: string;
  assetNumber: string;
  applianceTypeName: string;
  updatedAt: Date;
}): ExceptionItem {
  return {
    category: "UNINSPECTED_RETURN",
    severity: "medium",
    title: `${appliance.applianceTypeName} (${appliance.assetNumber}) is back but hasn't been inspected`,
    detail: "It's waiting to be inspected — it can't go back out to another customer until it's checked over.",
    href: `/desk/inventory/${appliance.id}`,
    since: appliance.updatedAt,
  };
}

export function missingRepairCostException(job: {
  id: string;
  completedAt: Date;
  applianceLabel: string | null;
}): ExceptionItem {
  return {
    category: "MISSING_REPAIR_COST",
    severity: "medium",
    title: `Repair cost not logged${job.applianceLabel ? ` (${job.applianceLabel})` : ""}`,
    detail:
      "This repair job is marked Completed but has no parts/labor cost entered — appliance profitability (Fleet page) is undercounting it as $0 until you add it.",
    href: `/desk/jobs/${job.id}`,
    since: job.completedAt,
  };
}

/** A fixed-term agreement (e.g. 12 months) whose term end date has
 * passed but is still marked ACTIVE — nobody recorded a renewal, a
 * switch to month-to-month, or an end. Purely a "someone should look at
 * this" flag; it never changes the agreement itself. */
export function agreementTermExpiredException(agreement: {
  id: string;
  customerName: string;
  termMonths: number;
  termEndDate: Date;
}): ExceptionItem {
  return {
    category: "AGREEMENT_TERM_EXPIRED",
    severity: "medium",
    title: `${agreement.customerName}'s ${agreement.termMonths}-month term has ended`,
    detail: `Term ended ${agreement.termEndDate.toLocaleDateString("en-US")} but the agreement is still marked active — check whether they're renewing, going month-to-month, or returning the equipment.`,
    href: `/desk/agreements/${agreement.id}`,
    since: agreement.termEndDate,
  };
}

/** A currently-rented appliance with no logged maintenance visit (or
 * none since it went into service) in over
 * APPLIANCE_MAINTENANCE_DUE_DAYS. */
export function applianceMaintenanceDueException(appliance: {
  id: string;
  assetNumber: string;
  applianceTypeName: string;
  sinceDate: Date;
}): ExceptionItem {
  return {
    category: "APPLIANCE_MAINTENANCE_DUE",
    severity: "medium",
    title: `${appliance.applianceTypeName} (${appliance.assetNumber}) may be due for a maintenance check`,
    detail: `No completed maintenance visit logged since ${appliance.sinceDate.toLocaleDateString("en-US")} — worth scheduling a routine check-in with the customer.`,
    href: `/desk/inventory/${appliance.id}`,
    since: appliance.sinceDate,
  };
}

/** Oldest first within a category, but overall sorted high severity
 * first, then by how long it's been sitting. */
/** Filing attention is computed from OPEN periods, never stored or dismissed. */
/** "File and pay $X on SUTS by Oct 20" / "File a $0 return on SUTS by Oct 20" (D-WA1); the old wording when the total is unknown. */
function taxReturnTitle(input: {
  accountName: string; legalDueOn: Date; amountCents?: number | null;
  kind?: "SALES_RETURN" | "USE_TAX_RETURN" | "RETAIL_DELIVERY_FEE_RETURN";
}, overdue: boolean): string {
  if (typeof input.amountCents !== "number" || !Number.isSafeInteger(input.amountCents) || input.amountCents < 0) {
    return `${input.accountName} return ${overdue ? "overdue" : "due"}`;
  }
  const site = input.kind === "RETAIL_DELIVERY_FEE_RETURN" ? "Colorado Revenue Online" : "SUTS";
  const by = shortDateLabel(businessDateKey(input.legalDueOn));
  const what = input.amountCents === 0
    ? `File a $0 return on ${site} by ${by}`
    : `File and pay ${formatMoney(input.amountCents)} on ${site} by ${by}`;
  return overdue ? `${what} (overdue)` : what;
}

export function taxReturnDueException(input: {
  accountName: string;
  periodId?: string;
  periodEnd: Date;
  dueOn: Date;
  legalDueOn: Date;
  reminderDaysBefore: number[];
  zeroReturn: boolean;
  readOnly: boolean;
  now: Date;
  /** W-9: when the period's total is known the To do says exactly what to file and pay. */
  amountCents?: number | null;
  kind?: "SALES_RETURN" | "USE_TAX_RETURN" | "RETAIL_DELIVERY_FEE_RETURN";
  /** TFA-1: the day the timing rule says to act, shown next to the due date. */
  actOnKey?: string;
}): ExceptionItem {
  const daysUntilLegalDue = businessDaysBetween(input.now, input.legalDueOn);
  const daysUntilBaseDue = businessDaysBetween(input.now, input.dueOn);
  const nearestWindow = Math.min(
    ...input.reminderDaysBefore.filter((days) => Number.isInteger(days) && days > 0),
    Number.POSITIVE_INFINITY,
  );
  const urgent =
    daysUntilLegalDue < 0 ||
    daysUntilBaseDue <= 0 ||
    (Number.isFinite(nearestWindow) && daysUntilBaseDue <= nearestWindow);
  return {
    category: "TAX_RETURN_DUE",
    severity: urgent ? "high" : "medium",
    title: taxReturnTitle(input, daysUntilLegalDue < 0),
    detail: `${input.zeroReturn ? "A zero return may still be required. " : ""}` +
      `Filing period ended ${businessDateKey(input.periodEnd)}. ` +
      (input.actOnKey ? `File and pay on ${shortDateLabel(input.actOnKey)}. ` : "") +
      `Legal deadline: ${businessDateKey(input.legalDueOn)}.` +
      (input.readOnly ? " Only the Owner can change filing details." : " Open the filing workspace to review the return."),
    href: input.periodId ? `/desk/sales-tax/returns/${input.periodId}` : "/desk/sales-tax/returns",
    dueOn: input.dueOn,
    dueDateOnly: true,
    since: input.periodEnd,
  };
}

export function taxLicenseRenewalException(input: {
  accountName: string;
  expiresOn: Date;
  now: Date;
  readOnly: boolean;
}): ExceptionItem {
  const daysLeft = businessDaysBetween(input.now, input.expiresOn);
  return {
    category: "TAX_LICENSE_RENEWAL",
    severity: daysLeft <= 7 ? "high" : "medium",
    title: `Tax license ${daysLeft < 0 ? "expired" : "renewal"} — ${input.accountName}`,
    detail: `License expiration: ${businessDateKey(input.expiresOn)}.` +
      (input.readOnly ? " Ask an Owner to update the license." : " Check and renew the license."),
    href: "/desk/sales-tax/setup",
    dueOn: input.expiresOn,
    dueDateOnly: true,
    since: input.expiresOn,
  };
}

/**
 * Is it time to re-check that the SUTS setup still matches SUTS? Each January, and whenever the last check is a year old.
 * An account in use that has never been confirmed is also due. Dates are Colorado business days.
 */
export function taxSetupCheckDue(setupCheckedOn: Date | null, inUse: boolean, now: Date): boolean {
  if (!setupCheckedOn) return inUse;
  const checked = businessDateKey(setupCheckedOn), today = businessDateKey(now);
  const thisYear = today.slice(0, 4);
  if (today.slice(5, 7) === "01" && checked < `${thisYear}-01-01`) return true;
  const yearLater = `${String(Number(checked.slice(0, 4)) + 1)}${checked.slice(4)}`;
  return today >= yearLater;
}

export function taxSetupCheckException(input: {
  accountId: string; accountName: string; setupCheckedOn: Date | null; now: Date; readOnly: boolean;
}): ExceptionItem {
  return {
    category: "TAX_SETUP_CHECK",
    severity: "medium",
    title: `Check your SUTS setup still matches SUTS — ${input.accountName}`,
    detail: (input.setupCheckedOn
      ? `Last checked ${businessDateKey(input.setupCheckedOn)}. `
      : "You have not confirmed this setup against SUTS yet. ") +
      "Compare the areas, codes and order here with what SUTS shows, then tick \"I checked these details against SUTS today\" and save." +
      (input.readOnly ? " Only the Owner can confirm it." : ""),
    href: `/desk/sales-tax/setup/accounts/${input.accountId}`,
    since: input.setupCheckedOn ?? input.now,
  };
}

export function taxAmendmentDueException(input: {
  id: string; periodId?: string; accountName: string; detectedAt: Date; additionalTaxCents: number;
}): ExceptionItem {
  return {
    category: "TAX_AMENDMENT_DUE",
    severity: input.additionalTaxCents > 0 ? "high" : "medium",
    title: "Amended tax return needs review — " + input.accountName,
    detail: input.additionalTaxCents > 0
      ? "A correction shows additional tax owed. Review the amendment before filing."
      : "Review the correction or credit and record how it was handled.",
    since: input.detectedAt,
    href: input.periodId ? `/desk/sales-tax/returns/${input.periodId}/amend` : "/desk/sales-tax/returns",
  };
}
export function taxFilingNotReadyException(input: {
  accountName: string;
  periodId?: string;
  dueOn: Date;
  periodEnd: Date;
  problems: string[];
  now: Date;
}): ExceptionItem {
  return {
    category: "TAX_FILING_NOT_READY",
    severity: businessDaysBetween(input.now, input.dueOn) <= 7 ? "high" : "medium",
    title: "Tax return needs setup before filing — " + input.accountName,
    detail: "Resolve filing blockers: " + input.problems.slice(0, 3).join("; "),
    since: input.periodEnd,
    href: input.periodId ? `/desk/sales-tax/returns/${input.periodId}` : "/desk/sales-tax/returns",
  };
}
export function sortExceptions(items: ExceptionItem[]): ExceptionItem[] {
  return [...items].sort((a, b) => {
    if (a.dueOn && b.dueOn && a.dueOn.getTime() !== b.dueOn.getTime())
      return a.dueOn.getTime() - b.dueOn.getTime();
    if (!!a.dueOn !== !!b.dueOn) return a.dueOn ? -1 : 1;
    if (a.severity !== b.severity) return ({high:0,medium:1,low:2}[a.severity])-({high:0,medium:1,low:2}[b.severity]);
    return a.since.getTime() - b.since.getTime();
  });
}

/**
 * An appliance still recorded under the retired "Washer + Dryer Set" type (W-16B). A set is two machines; this record
 * needs splitting so each machine has its own model, serial and history. Nothing is billed or changed until the owner
 * does it on the guided screen.
 */
export function oldSetApplianceException(item: {
  id: string;
  assetNumber: string;
  contents: string;
  createdAt: Date;
}): ExceptionItem {
  return {
    category: "OLD_SET_APPLIANCE",
    severity: "medium",
    title: `Split ${item.assetNumber} into separate machines (${item.contents})`,
    detail:
      "A set is now two separate machines, each with its own model and serial number. The guided screen keeps this record's history on the first machine and adds the other; any rental it is on stays exactly as signed.",
    href: `/desk/inventory/${item.id}/split`,
    since: item.createdAt,
  };
}

/**
 * A machine taken for repair with no replacement yet (W-21A, D-WB8 case 3). The customer keeps paying the normal price
 * and is credited the days without it once a machine is back, so the sooner it is replaced the smaller the credit.
 * Urgent after the owner's escalation days (setting, starting value 3).
 */
export function outOfServiceException(item: {
  applianceId: string;
  assetNumber: string;
  typeName: string;
  customerName: string;
  startedOn: Date;
  daysOut: number;
  escalationDays: number;
}): ExceptionItem {
  return {
    category: "OUT_OF_SERVICE",
    severity: item.daysOut >= item.escalationDays ? "high" : "medium",
    title: `Return or replace ${item.customerName}'s ${item.typeName.toLowerCase()} (out for repair ${item.daysOut} ${item.daysOut === 1 ? "day" : "days"})`,
    detail: `${item.assetNumber} was taken for repair with no replacement. The customer is credited each day without it once a machine is back: schedule a replacement swap, record the same machine delivered back, mark a set machine the customer is done with (single price for the rest), or close it.`,
    href: `/desk/inventory/${item.applianceId}/out-of-service`,
    since: item.startedOn,
  };
}
