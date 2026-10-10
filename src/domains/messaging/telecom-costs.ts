import { Prisma } from "@prisma/client";
import { telecomDecimal, roundTelecomTotalToCents } from "./telecom-decimal";

export type UsageCostObservation = {
  id: string; category: string; isTotal: boolean;
  startDate: Date; endDate: Date; price: Prisma.Decimal | null;
  currency: string; providerAsOf: Date; capturedAt: Date;
};
const LEAF_CATEGORIES = new Map<string,string>([
  ["sms-inbound", "SMS"], ["sms-outbound", "SMS"],
  ["calls-inbound", "VOICE"], ["calls-outbound", "VOICE"],
  ["phonenumbers-local", "FIXED"], ["phonenumbers-mobile", "FIXED"],
] as const);
const UTC_DAY = 86_400_000;
function day(date: Date): string { return date.toISOString().slice(0, 10); }
function latest(rows: readonly UsageCostObservation[]): UsageCostObservation | null {
  return [...rows].sort((a,b) =>
    +b.providerAsOf - +a.providerAsOf || +b.capturedAt - +a.capturedAt ||
    b.id.localeCompare(a.id))[0] ?? null;
}
function dollarsToCentsOrNull(value: Prisma.Decimal | null): number | null {
  return value === null ? null : roundTelecomTotalToCents(value);
}
export type ProviderUsageSummary = {
  accountTotalCents: number | null; complete: boolean; coverage: string;
  currency: string | null; breakdownCents: Record<string,number>;
  unknownCategories: string[]; residualCents: number | null;
  incompleteComponents: string[];
};
/** GMT interval [start, end] inclusive, never a Denver-labeled month. */
export function summarizeProviderUsage(
  rows: readonly UsageCostObservation[], start: Date, end: Date,
): ProviderUsageSummary {
  if (!(start instanceof Date && end instanceof Date) ||
      !Number.isFinite(+start) || !Number.isFinite(+end) ||
      start > end || day(start) !== start.toISOString().slice(0,10) ||
      +end - +start > 93 * UTC_DAY || start.getUTCHours() !== 0 ||
      end.getUTCHours() !== 0 || start.getUTCMinutes() !== 0 ||
      end.getUTCMinutes() !== 0) throw new Error("INVALID_PROVIDER_PERIOD");

  const eligible = rows.filter(r => +r.startDate >= +start && +r.endDate <= +end);
  const currencies = new Set(eligible.map(r=>r.currency));
  if (currencies.size > 1 || [...currencies].some(c=> !/^[A-Z]{3}$/.test(c))) {
    throw new Error("INCOMPARABLE_PROVIDER_CURRENCY");
  }
  const currency = currencies.values().next().value ?? null;
  const exact = latest(eligible.filter(r => r.isTotal &&
    +r.startDate === +start && +r.endDate === +end));
  let total: Prisma.Decimal | null = exact?.price ?? null;
  let coverage = exact ? "EXACT_GMT_PERIOD" : "INCOMPLETE_GMT_PERIOD";
  if (!exact) {
    let sum = new Prisma.Decimal(0), everyDay = true;
    for (let when=+start; when<=+end; when+=UTC_DAY) {
      const row = latest(eligible.filter(r=>r.isTotal &&
        +r.startDate===when && +r.endDate===when));
      if (!row || row.price===null) { everyDay=false; break; }
      sum = sum.plus(telecomDecimal(row.price));
    }
    if (everyDay) { total = sum; coverage = "COMPLETE_GMT_DAYS"; }
  }
  const breakdownCents: Record<string,number> = {};
  const unknownCategories = new Set<string>();
  const incompleteComponents: string[] = [];
  let breakdownSum = new Prisma.Decimal(0);
  // Only exact matching provider windows produce a defensible breakdown.
  const children = exact ? eligible.filter(r =>
    !r.isTotal && +r.startDate===+start && +r.endDate===+end) : [];
  const byCategory = new Map<string,UsageCostObservation[]>();
  for (const row of children) {
    const list=byCategory.get(row.category)??[]; list.push(row);
    byCategory.set(row.category,list);
  }
  for (const [category, observations] of byCategory) {
    if (!LEAF_CATEGORIES.has(category)) {
      unknownCategories.add(category); continue;
    }
    const current=latest(observations);
    if (!current?.price) { incompleteComponents.push(category); continue; }
    breakdownSum = breakdownSum.plus(telecomDecimal(current.price));
    breakdownCents[category] = dollarsToCentsOrNull(telecomDecimal(current.price))!;
  }
  if (!exact) incompleteComponents.push("BREAKDOWN_WINDOW");
  const residualCents = total === null || incompleteComponents.length
    ? null : dollarsToCentsOrNull(total.minus(breakdownSum));
  return {
    accountTotalCents: dollarsToCentsOrNull(total), complete: total !== null,
    coverage, currency, breakdownCents, unknownCategories: [...unknownCategories].sort(),
    residualCents, incompleteComponents,
  };
}
export type ResourceCostEvidence = {
  amount: Prisma.Decimal; currency: string;
  classification: "ESTIMATED" | "PROVIDER_REPORTED" | "INVOICE_RECONCILED";
  messageAttemptId: string | null; callLegId: string | null;
  supersededBy?: { id: string } | null;
};
export type ResourceCostSummary = {
  estimatedCents: number | null; providerReportedCents: number | null;
  providerAttributedCents: number | null; providerUnallocatedCents: number | null;
  currency: string | null; invoiceFactCents: number | null;
};
export function summarizeResourceCosts(rows: readonly ResourceCostEvidence[]): ResourceCostSummary {
  const current=rows.filter(r=>!r.supersededBy);
  const currencies=new Set(current.map(r=>r.currency));
  if (currencies.size>1 || [...currencies].some(v=>!/^[A-Z]{3}$/.test(v))) {
    throw new Error("INCOMPARABLE_RESOURCE_CURRENCY");
  }
  const sum = (className: ResourceCostEvidence["classification"], attributed?: boolean) => {
    const matches=current.filter(r=>r.classification===className && (
      attributed===undefined || Boolean(r.messageAttemptId||r.callLegId)===attributed));
    if (!matches.length) return null;
    const total=matches.reduce((v,r)=>v.plus(telecomDecimal(r.amount)),new Prisma.Decimal(0));
    return dollarsToCentsOrNull(total);
  };
  return {
    estimatedCents:sum("ESTIMATED"), providerReportedCents:sum("PROVIDER_REPORTED"),
    providerAttributedCents:sum("PROVIDER_REPORTED",true),
    providerUnallocatedCents:sum("PROVIDER_REPORTED",false),
    invoiceFactCents:sum("INVOICE_RECONCILED"),
    currency:[...currencies][0]??null,
  };
}
export type ExplicitEstimate = {
  component: string; quantity: string | null; unitPrice: string | null;
};
/** Never silently assumes absent rate, carrier fee or tax means free. */
export function estimateKnownTelecomCosts(
  entries: readonly ExplicitEstimate[], currency: string, allComponentsVerified: boolean,
): { knownCents: number | null; missing: string[]; complete: boolean; currency: string } {
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("INVALID_ESTIMATE_CURRENCY");
  const missing: string[]=[];
  let total=new Prisma.Decimal(0), observed=0;
  for (const entry of entries) {
    if (entry.quantity===null || entry.unitPrice===null) {
      missing.push(entry.component); continue;
    }
    const quantity=telecomDecimal(entry.quantity);
    if (quantity.isNegative()) throw new Error("INVALID_ESTIMATE_QUANTITY");
    total=total.plus(quantity.times(telecomDecimal(entry.unitPrice)));
    observed++;
  }
  if (!allComponentsVerified) missing.push("UNVERIFIED_PROVIDER_FEES_AND_TAXES");
  return {
    knownCents:observed===0 ? null : dollarsToCentsOrNull(total),
    missing, complete:observed>0 && missing.length===0, currency,
  };
}
export type DifferenceTolerance = {
  absoluteCents: number | null; percentBasisPoints: number | null;
  combination: "ANY" | "ALL";
};
export function reconcileVerifiedTelecomStatement(
  providerCents: number | null, providerCurrency: string | null,
  verifiedStatement: { invoiceTotalCents: number; currency: string } | null,
  tolerance: DifferenceTolerance,
): { differenceCents: number | null; mismatch: boolean | null; statementCents: number | null } {
  if (!verifiedStatement) return { differenceCents:null,mismatch:null,statementCents:null };
  const statement=verifiedStatement.invoiceTotalCents;
  if (!Number.isSafeInteger(statement) || (providerCents!==null && !Number.isSafeInteger(providerCents))) {
    throw new Error("INVALID_TELECOM_CENTS");
  }
  if (providerCents===null) return { differenceCents:null,mismatch:null,statementCents:statement };
  if (providerCurrency !== verifiedStatement.currency) throw new Error("INCOMPARABLE_STATEMENT_CURRENCY");
  if (tolerance.absoluteCents!==null && (!Number.isSafeInteger(tolerance.absoluteCents) || tolerance.absoluteCents<0)) {
    throw new Error("INVALID_TOLERANCE");
  }
  if (tolerance.percentBasisPoints!==null &&
      (!Number.isSafeInteger(tolerance.percentBasisPoints) || tolerance.percentBasisPoints<0 ||
        tolerance.percentBasisPoints>100000)) throw new Error("INVALID_TOLERANCE");
  const difference=providerCents-statement;
  if (!Number.isSafeInteger(difference)) throw new Error("INVALID_TELECOM_CENTS");
  const tests: boolean[]=[];
  if (tolerance.absoluteCents!==null) tests.push(Math.abs(difference)>tolerance.absoluteCents);
  if (tolerance.percentBasisPoints!==null && statement!==0) {
    tests.push(BigInt(Math.abs(difference))*BigInt(10000) >
      BigInt(Math.abs(statement))*BigInt(tolerance.percentBasisPoints));
  }
  return {
    differenceCents:difference, statementCents:statement,
    mismatch:tests.length===0 ? null
      : tolerance.combination==="ALL" ? tests.length===Number(tolerance.absoluteCents!==null)+
          Number(tolerance.percentBasisPoints!==null) && tests.every(Boolean)
        : tests.some(Boolean),
  };
}
