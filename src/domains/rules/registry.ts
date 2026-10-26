import { z } from "zod";
import { formatMoney } from "@/lib/money-ui";

/**
 * TFA-1: the registry of dated legal rules (TAX-FEE-AUTOPILOT section 2).
 * Pure: no database access here. Each rule knows its shape (zod), how to
 * explain its value in plain words, when it changes, and how the owner edits
 * it (money fields in dollars on the screen, cents in storage).
 */

export type RuleArea = "SALES_TAX" | "USE_TAX" | "RDF" | "FEDERAL" | "RECORDS" | "LEASES";
export type RuleChangeKind = "FIXED_JUL_1" | "FIXED_JAN_1" | "ANY_DATE";

export type RuleFieldKind = "money" | "integer" | "percent" | "month-day" | "text";
export type RuleField = {
  name: string;
  label: string;
  kind: RuleFieldKind;
  min?: number;
  max?: number;
};

export type RuleDef<T> = {
  key: string;
  title: string;
  explain: string;
  area: RuleArea;
  schema: z.ZodType<T>;
  describe: (value: T) => string;
  change: RuleChangeKind;
  /** How the owner edits the value; one field per JSON property (or one for a scalar). */
  fields: RuleField[];
  watch?: string;
  decisionId?: string;
};

const moneyField = (name: string, label: string, max = 100000000): RuleField =>
  ({ name, label, kind: "money", min: 0, max });
const integerField = (name: string, label: string, min: number, max: number): RuleField =>
  ({ name, label, kind: "integer", min, max });
const percentField = (name: string, label: string, min = 0, max = 100): RuleField =>
  ({ name, label, kind: "percent", min, max });

const monthDay = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, "Use MM-DD.");

function defineRule<T>(def: RuleDef<T>): RuleDef<T> {
  return def;
}

export const RULES = {
  "co.rdf.amount": defineRule({
    key: "co.rdf.amount",
    title: "Colorado retail delivery fee",
    explain: "The fee on each Colorado retail delivery, set by the state each July 1. One fee per sale, however many trips.",
    area: "RDF",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} per delivery`,
    change: "FIXED_JUL_1",
    fields: [moneyField("value", "Fee per delivery ($)")],
    watch: "https://tax.colorado.gov/retail-delivery-fee-rates",
  }),
  "co.rdf.qualified_threshold": defineRule({
    key: "co.rdf.qualified_threshold",
    title: "Small-seller delivery-fee limit",
    explain: "A business whose Colorado retail sales last year were at or below this amount pays no delivery fee this year.",
    area: "RDF",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} of Colorado retail sales last year`,
    change: "ANY_DATE",
    fields: [moneyField("value", "Last year's Colorado sales limit ($)")],
  }),
  "co.sales.frequency_thresholds": defineRule({
    key: "co.sales.frequency_thresholds",
    title: "How often to file sales tax",
    explain: "Colorado decides how often you file from your average monthly sales tax: annual when it is at or below the first amount, quarterly when it is under the second.",
    area: "SALES_TAX",
    schema: z.object({
      annualMaxMonthlyCents: z.number().int().min(0),
      quarterlyMaxMonthlyCents: z.number().int().min(0),
    }),
    describe: (v: { annualMaxMonthlyCents: number; quarterlyMaxMonthlyCents: number }) => `Annual at ${formatMoney(v.annualMaxMonthlyCents)} a month or less; quarterly under ${formatMoney(v.quarterlyMaxMonthlyCents)} a month`,
    change: "FIXED_JAN_1",
    fields: [
      moneyField("annualMaxMonthlyCents", "Annual when monthly tax is at or below ($)"),
      moneyField("quarterlyMaxMonthlyCents", "Quarterly when monthly tax is under ($)"),
    ],
  }),
  "co.sales.state_service_fee": defineRule({
    key: "co.sales.state_service_fee",
    title: "Service fee kept on state sales tax",
    explain: "Colorado allows no service fee on state sales tax from Jan 1, 2026. Local lines keep their own fee.",
    area: "SALES_TAX",
    schema: z.number().int().min(0),
    describe: (v: number) => v === 0 ? "No service fee on state sales tax" : `${(v / 1000).toFixed(3)}% kept on state sales tax`,
    change: "FIXED_JAN_1",
    fields: [integerField("value", "Service fee (milli-percent)", 0, 100000)],
  }),
  "co.use.monthly_threshold": defineRule({
    key: "co.use.monthly_threshold",
    title: "Use-tax monthly filing limit",
    explain: "When use tax due for the year passes this amount at any month end, monthly returns are due for the rest of the year.",
    area: "USE_TAX",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} of use tax due in a year`,
    change: "FIXED_JAN_1",
    fields: [moneyField("value", "Use-tax limit for the year ($)")],
  }),
  "co.penalty": defineRule({
    key: "co.penalty",
    title: "Late-filing penalty",
    explain: "What Colorado adds when a return is late: the greater of the minimum or the first percent, plus a monthly percent up to the maximum.",
    area: "SALES_TAX",
    schema: z.object({
      minCents: z.number().int().min(0),
      firstPercent: z.number().min(0),
      perMonthPercent: z.number().min(0),
      maxPercent: z.number().min(0),
    }),
    describe: (v: { minCents: number; firstPercent: number; perMonthPercent: number; maxPercent: number }) => `Greater of ${formatMoney(v.minCents)} or ${v.firstPercent}%, plus ${v.perMonthPercent}% a month (max ${v.maxPercent}%)`,
    change: "ANY_DATE",
    fields: [
      moneyField("minCents", "Minimum penalty ($)"),
      percentField("firstPercent", "First penalty (%)"),
      percentField("perMonthPercent", "Added each month (%)"),
      percentField("maxPercent", "Maximum penalty (%)"),
    ],
  }),
  "co.interest": defineRule({
    key: "co.interest",
    title: "Interest on late tax",
    explain: "Yearly interest Colorado charges on late tax, set each year. The discounted rate applies when the return is filed on time but paid late.",
    area: "SALES_TAX",
    schema: z.object({ regular: z.number().min(0), discounted: z.number().min(0) }),
    describe: (v: { regular: number; discounted: number }) => `${v.regular}% regular, ${v.discounted}% discounted`,
    change: "FIXED_JAN_1",
    fields: [
      percentField("regular", "Regular interest (%)"),
      percentField("discounted", "Discounted interest (%)"),
    ],
  }),
  "co.lease.short_term_months": defineRule({
    key: "co.lease.short_term_months",
    title: "Short-term lease limit",
    explain: "A lease of this many months or less counts as short-term for Colorado tax.",
    area: "LEASES",
    schema: z.number().int().min(0),
    describe: (v: number) => `${v} months or less`,
    change: "ANY_DATE",
    fields: [integerField("value", "Short-term lease limit (months)", 0, 120)],
  }),
  "co.license.expiry": defineRule({
    key: "co.license.expiry",
    title: "Sales-tax license expiry",
    explain: "A Colorado sales-tax license expires December 31 of odd years.",
    area: "SALES_TAX",
    schema: z.object({ rule: z.literal("DEC_31_ODD_YEARS") }),
    describe: () => "December 31 of odd years",
    change: "ANY_DATE",
    fields: [{ name: "rule", label: "Expiry rule", kind: "text" }],
  }),
  "us.1099.threshold": defineRule({
    key: "us.1099.threshold",
    title: "1099 reporting limit",
    explain: "Payments to a supplier in a year at or above this amount go on the year-end 1099 review.",
    area: "FEDERAL",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} paid to a supplier in a year`,
    change: "FIXED_JAN_1",
    fields: [moneyField("value", "1099 limit ($)")],
  }),
  "us.1099.deadlines": defineRule({
    key: "us.1099.deadlines",
    title: "1099 deadlines",
    explain: "When 1099 forms are due: NEC to the supplier and the IRS, MISC to the supplier, then to the IRS on paper or electronically.",
    area: "FEDERAL",
    schema: z.object({
      necBoth: monthDay, miscPayee: monthDay, miscIrsPaper: monthDay, miscIrsElectronic: monthDay,
    }),
    describe: (v: { necBoth: string; miscPayee: string; miscIrsPaper: string; miscIrsElectronic: string }) => `1099-NEC by ${monthDayWords(v.necBoth)}; 1099-MISC to the supplier ${monthDayWords(v.miscPayee)}, to the IRS ${monthDayWords(v.miscIrsPaper)} (paper) / ${monthDayWords(v.miscIrsElectronic)} (electronic)`,
    change: "FIXED_JAN_1",
    fields: [
      { name: "necBoth", label: "1099-NEC, to supplier and IRS (MM-DD)", kind: "month-day" },
      { name: "miscPayee", label: "1099-MISC, to supplier (MM-DD)", kind: "month-day" },
      { name: "miscIrsPaper", label: "1099-MISC, to IRS on paper (MM-DD)", kind: "month-day" },
      { name: "miscIrsElectronic", label: "1099-MISC, to IRS electronically (MM-DD)", kind: "month-day" },
    ],
  }),
  "us.section179": defineRule({
    key: "us.section179",
    title: "Section 179 expensing",
    explain: "How much equipment cost a business can expense in the year it is bought, and where the limit starts shrinking.",
    area: "FEDERAL",
    schema: z.object({
      limitCents: z.number().int().min(0),
      phaseoutCents: z.number().int().min(0),
    }),
    describe: (v: { limitCents: number; phaseoutCents: number }) => `Limit ${formatMoney(v.limitCents)}; phase-out from ${formatMoney(v.phaseoutCents)}`,
    change: "FIXED_JAN_1",
    fields: [
      moneyField("limitCents", "Section 179 limit ($)", 10000000000),
      moneyField("phaseoutCents", "Phase-out starts at ($)", 10000000000),
    ],
  }),
  "us.bonus_depreciation": defineRule({
    key: "us.bonus_depreciation",
    title: "Bonus depreciation",
    explain: "The share of new equipment cost that can be expensed in the first year, for property acquired after the date shown.",
    area: "FEDERAL",
    schema: z.object({ percent: z.number().min(0).max(100), acquiredAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }),
    describe: (v: { percent: number; acquiredAfter: string }) => `${v.percent}% for property acquired after ${v.acquiredAfter}`,
    change: "ANY_DATE",
    fields: [
      percentField("percent", "Bonus depreciation (%)"),
      { name: "acquiredAfter", label: "Applies to property acquired after (YYYY-MM-DD)", kind: "text" },
    ],
  }),
  "records.keep_years": defineRule({
    key: "records.keep_years",
    title: "How long to keep records",
    explain: "Receipts for appliances and parts are kept at least this long after the appliance leaves the fleet. A receipt a filed return relies on is never removed.",
    area: "RECORDS",
    schema: z.number().int().min(1).max(50),
    describe: (v: number) => `${v} ${v === 1 ? "year" : "years"} after the appliance leaves the fleet`,
    change: "ANY_DATE",
    fields: [integerField("value", "Keep records for (years)", 1, 50)],
    decisionId: "IN-71",
  }),
  "co.small_claims_limit": defineRule({
    key: "co.small_claims_limit",
    title: "Small-claims limit",
    explain: "The most a Colorado small-claims case can ask for. A larger unpaid amount can't go to small claims.",
    area: "LEASES",
    schema: z.number().int().min(0),
    describe: (v: number) => `Up to ${formatMoney(v)}`,
    change: "ANY_DATE",
    fields: [moneyField("value", "Small-claims limit")],
  }),
  "co.small_claims_filing_limits": defineRule({
    key: "co.small_claims_filing_limits",
    title: "How many small-claims cases you can file",
    explain: "The court limits how many small-claims cases one person can file. The app counts the cases you record as filed.",
    area: "LEASES",
    schema: z.object({ perMonth: z.number().int().min(1), perYear: z.number().int().min(1) }),
    describe: (v: { perMonth: number; perYear: number }) => `${v.perMonth} a month, ${v.perYear} a year per county`,
    change: "ANY_DATE",
    fields: [integerField("perMonth", "Cases a month", 1, 100), integerField("perYear", "Cases a year", 1, 1000)],
  }),
  "co.small_claims_fees": defineRule({
    key: "co.small_claims_fees",
    title: "Small-claims filing fee",
    explain: "The county court's fee to file, which depends on the amount claimed.",
    area: "LEASES",
    schema: z.object({ lowMaxCents: z.number().int().min(0), lowFeeCents: z.number().int().min(0), highFeeCents: z.number().int().min(0) }),
    describe: (v: { lowMaxCents: number; lowFeeCents: number; highFeeCents: number }) =>
      `${formatMoney(v.lowFeeCents)} up to ${formatMoney(v.lowMaxCents)}, otherwise ${formatMoney(v.highFeeCents)}`,
    change: "ANY_DATE",
    fields: [moneyField("lowMaxCents", "Lower fee applies up to"), moneyField("lowFeeCents", "Lower fee"), moneyField("highFeeCents", "Higher fee")],
  }),
  "greeley.sales_rate": defineRule({
    key: "greeley.sales_rate",
    title: "Greeley sales-tax rate",
    explain: "The City of Greeley's own sales-tax rate, on top of the state rate. Greeley is home-rule and self-collected, so its changes come by city ordinance on any date.",
    area: "SALES_TAX",
    schema: z.number().int().min(0),
    describe: (v: number) => `${(v / 1000).toFixed(2)}%`,
    change: "ANY_DATE",
    fields: [integerField("value", "Greeley rate (milli-percent)", 0, 100000)],
  }),
};

export type RuleKey = keyof typeof RULES;
export const RULE_KEYS = Object.keys(RULES) as RuleKey[];

export function isRuleKey(value: string): value is RuleKey {
  return (RULE_KEYS as string[]).includes(value);
}

export function ruleDef<K extends RuleKey>(key: K): (typeof RULES)[K] {
  return RULES[key];
}

/** Describe a parsed value for any key (the screen's "Now:" line). */
export function describeRuleValue(key: RuleKey, value: unknown): string {
  const def = RULES[key] as unknown as RuleDef<unknown>;
  return def.describe(value);
}

/** Origin priority when two versions share a start date (spec section 2). */
export const ORIGIN_PRIORITY: Record<string, number> = {
  PROFESSIONAL: 4,
  OWNER: 3,
  OFFICIAL_WATCH: 2,
  RESEARCHED: 1,
};

/** Plain-words state for a version on the Rules screen. */
export function ruleStateLabel(version: { origin: string; provisional: boolean; createdByUserId?: string | null }): string {
  if (version.origin === "OWNER") return "Set by you";
  if (version.origin === "PROFESSIONAL") return "Confirmed by your CPA or attorney";
  if (version.origin === "OFFICIAL_WATCH") return "From the official page";
  return version.provisional ? "Researched — not confirmed" : "Researched";
}

function monthDayWords(value: string): string {
  const [month, day] = value.split("-").map(Number);
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[(month ?? 1) - 1]} ${day}`;
}
