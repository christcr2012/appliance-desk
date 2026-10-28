import { z } from "zod";
import { formatMoney } from "@/lib/money-ui";

/**
 * TFA-1: the registry of dated legal rules (TAX-FEE-AUTOPILOT section 2).
 * Pure: no database access here. Each rule knows its shape (zod), how to
 * explain its value in plain words, when it changes, and how the owner edits
 * it (money fields in dollars on the screen, cents in storage).
 */

export type RuleArea = "SALES_TAX" | "USE_TAX" | "RDF" | "FEDERAL" | "RECORDS" | "LEASES" | "PROPERTY_TAX" | "STATE_INCOME";
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
    watch: "https://tax.colorado.gov/index.php/tax-topics-penalties-and-interest",
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
  "co.bpp.exemption_threshold": defineRule({
    key: "co.bpp.exemption_threshold",
    title: "Weld property declaration exemption",
    explain: "No Weld County business personal property declaration is required when the total actual value of the business's personal property is at or under this amount. Set by Colorado law and the county assessor each year.",
    area: "PROPERTY_TAX",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} or less in total value — no declaration needed`,
    change: "FIXED_JAN_1",
    fields: [moneyField("value", "Exemption limit ($)")],
    watch: "https://www.weldgov.com/departments/assessor",
  }),
  "co.bpp.extension": defineRule({
    key: "co.bpp.extension",
    title: "Weld declaration extension fees",
    explain: "What the Weld County Assessor charges to extend the April 15 declaration deadline, requested by April 15: one fee for 10 more days, a higher one for 20.",
    area: "PROPERTY_TAX",
    schema: z.object({
      tenDayFeeCents: z.number().int().min(0),
      twentyDayFeeCents: z.number().int().min(0),
    }),
    describe: (v: { tenDayFeeCents: number; twentyDayFeeCents: number }) =>
      `${formatMoney(v.tenDayFeeCents)} for 10 more days, ${formatMoney(v.twentyDayFeeCents)} for 20`,
    change: "ANY_DATE",
    fields: [
      moneyField("tenDayFeeCents", "10-day extension ($)"),
      moneyField("twentyDayFeeCents", "20-day extension ($)"),
    ],
    watch: "https://www.weldgov.com/departments/assessor",
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
    watch: "https://www.irs.gov/instructions/i1099mec",
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
  "us.mileage_rate": defineRule({
    key: "us.mileage_rate",
    title: "Business mileage rate",
    explain: "The IRS standard rate per business mile for a vehicle, used to work out the mileage deduction. Stored in tenths of a cent (725 = 72.5 cents).",
    area: "FEDERAL",
    schema: z.number().int().min(0).max(5000),
    describe: (v: number) => `${v / 10} cents per business mile`,
    change: "FIXED_JAN_1",
    fields: [integerField("value", "Rate (tenths of a cent per mile)", 0, 5000)],
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
  "us.de_minimis_per_item": defineRule({
    key: "us.de_minimis_per_item",
    title: "De minimis safe harbor limit",
    explain: "A bought item at or under this amount per item or invoice line can be expensed instead of capitalized, when the year's de minimis election is on and the written policy is in place.",
    area: "FEDERAL",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} per item or invoice line`,
    change: "FIXED_JAN_1",
    fields: [moneyField("value", "De minimis limit ($)", 10000000)],
    watch: "https://www.irs.gov/businesses/small-businesses-self-employed/tangible-property-final-regulations",
  }),
  "us.startup_costs": defineRule({
    key: "us.startup_costs",
    title: "Start-up costs (Section 195)",
    explain: "Costs from before the business began: a first-year deduction that shrinks once start-up costs pass the phase-out start, with the rest spread over the amortization months from the month the business begins.",
    area: "FEDERAL",
    schema: z.object({
      deductionCents: z.number().int().min(0),
      phaseoutStartCents: z.number().int().min(0),
      amortizationMonths: z.number().int().min(1),
    }),
    describe: (v: { deductionCents: number; phaseoutStartCents: number; amortizationMonths: number }) =>
      `${formatMoney(v.deductionCents)} first-year, shrinking past ${formatMoney(v.phaseoutStartCents)}; the rest over ${v.amortizationMonths} months`,
    change: "FIXED_JAN_1",
    fields: [
      moneyField("deductionCents", "First-year deduction ($)", 100000000),
      moneyField("phaseoutStartCents", "Phase-out starts at ($)", 10000000000),
      integerField("amortizationMonths", "Amortization (months)", 1, 600),
    ],
    watch: "https://www.irs.gov/publications/p583",
  }),
  "us.qbi": defineRule({
    key: "us.qbi",
    title: "Qualified business income (Section 199A)",
    explain: "The share of qualified business income the owner may deduct, with a minimum deduction once QBI reaches the minimum amount.",
    area: "FEDERAL",
    schema: z.object({
      percent: z.number().min(0).max(100),
      minimumCents: z.number().int().min(0),
      minimumQbiCents: z.number().int().min(0),
    }),
    describe: (v: { percent: number; minimumCents: number; minimumQbiCents: number }) =>
      `${v.percent}% of QBI; at least ${formatMoney(v.minimumCents)} when QBI is ${formatMoney(v.minimumQbiCents)} or more`,
    change: "FIXED_JAN_1",
    fields: [
      percentField("percent", "QBI deduction (%)"),
      moneyField("minimumCents", "Minimum deduction ($)", 10000000),
      moneyField("minimumQbiCents", "Minimum applies from QBI of ($)", 100000000),
    ],
    watch: "https://www.irs.gov/businesses/small-businesses-self-employed/qualified-business-income-deduction",
  }),
  "us.se_tax": defineRule({
    key: "us.se_tax",
    title: "Self-employment tax deduction",
    explain: "The share of self-employment tax the owner deducts, and the Social Security wage base the tax stops at.",
    area: "FEDERAL",
    schema: z.object({
      deductiblePercent: z.number().min(0).max(100),
      ssWageBaseCents: z.number().int().min(0),
    }),
    describe: (v: { deductiblePercent: number; ssWageBaseCents: number }) =>
      `${v.deductiblePercent}% deductible; Social Security wage base ${formatMoney(v.ssWageBaseCents)}`,
    change: "FIXED_JAN_1",
    fields: [
      percentField("deductiblePercent", "Deductible share (%)"),
      moneyField("ssWageBaseCents", "Social Security wage base ($)", 100000000),
    ],
    watch: "https://www.irs.gov/taxtopics/tc554",
  }),
  "us.se_tax_rates": defineRule({
    key: "us.se_tax_rates",
    title: "Self-employment tax rates",
    explain: "The rates the self-employment tax itself is worked out at: Social Security on earnings up to the wage base in us.se_tax, plus Medicare, charged on this share of net earnings once they reach the minimum.",
    area: "FEDERAL",
    schema: z.object({
      netEarningsPercent: z.number().gt(0).max(100),
      socialSecurityPercent: z.number().min(0).max(100),
      medicarePercent: z.number().min(0).max(100),
      minimumNetEarningsCents: z.number().int().min(0),
    }),
    describe: (v: { netEarningsPercent: number; socialSecurityPercent: number; medicarePercent: number; minimumNetEarningsCents: number }) =>
      `${v.socialSecurityPercent}% Social Security + ${v.medicarePercent}% Medicare on ${v.netEarningsPercent}% of net earnings, from ${formatMoney(v.minimumNetEarningsCents)}`,
    change: "FIXED_JAN_1",
    fields: [
      percentField("socialSecurityPercent", "Social Security rate (%)"),
      percentField("medicarePercent", "Medicare rate (%)"),
      percentField("netEarningsPercent", "Share of net earnings taxed (%)"),
      moneyField("minimumNetEarningsCents", "Applies from net earnings of ($)", 10000000),
    ],
    watch: "https://www.irs.gov/taxtopics/tc554",
  }),
  "us.mid_quarter": defineRule({
    key: "us.mid_quarter",
    title: "Mid-quarter convention threshold",
    explain: "If more than this share of the year's depreciable equipment is placed in service in the last three months, the mid-quarter convention applies and first-year depreciation shrinks. The Tax benefits page watches for it in October and November.",
    area: "FEDERAL",
    schema: z.object({ percent: z.number().gt(0).max(100) }),
    describe: (v: { percent: number }) => `More than ${v.percent}% of the year's basis in the last three months`,
    change: "FIXED_JAN_1",
    fields: [percentField("percent", "Threshold (%)")],
    watch: "https://www.irs.gov/publications/p946",
  }),
  "us.sep_ira": defineRule({
    key: "us.sep_ira",
    title: "SEP-IRA for the owner",
    explain: "What the owner can put into a SEP-IRA: roughly this share of net profit, up to the yearly maximum. The plan can be set up and funded as late as the return due date, extensions included.",
    area: "FEDERAL",
    schema: z.object({
      percentOfNetProfit: z.number().min(0).max(100),
      maxCents: z.number().int().min(0),
    }),
    describe: (v: { percentOfNetProfit: number; maxCents: number }) =>
      `About ${v.percentOfNetProfit}% of net profit, up to ${formatMoney(v.maxCents)}`,
    change: "FIXED_JAN_1",
    fields: [
      percentField("percentOfNetProfit", "Share of net profit (%)"),
      moneyField("maxCents", "Yearly maximum ($)", 100000000),
    ],
    watch: "https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people",
  }),
  "us.solo_401k": defineRule({
    key: "us.solo_401k",
    title: "Solo 401(k) for the owner",
    explain: "The owner's own deferral into a solo 401(k), plus the employer share, up to the combined yearly maximum.",
    area: "FEDERAL",
    schema: z.object({
      deferralCents: z.number().int().min(0),
      maxTotalCents: z.number().int().min(0),
    }),
    describe: (v: { deferralCents: number; maxTotalCents: number }) =>
      `${formatMoney(v.deferralCents)} deferral; ${formatMoney(v.maxTotalCents)} combined maximum`,
    change: "FIXED_JAN_1",
    fields: [
      moneyField("deferralCents", "Employee deferral ($)", 100000000),
      moneyField("maxTotalCents", "Combined maximum ($)", 100000000),
    ],
    watch: "https://www.irs.gov/retirement-plans/retirement-plans-for-self-employed-people",
  }),
  "us.home_office_simplified": defineRule({
    key: "us.home_office_simplified",
    title: "Home office, simplified method",
    explain: "The simplified home-office deduction: this amount per square foot of the office, up to the most square feet counted.",
    area: "FEDERAL",
    schema: z.object({
      rateCentsPerSqFt: z.number().int().min(0),
      maxSqFt: z.number().int().min(0),
    }),
    describe: (v: { rateCentsPerSqFt: number; maxSqFt: number }) =>
      `${formatMoney(v.rateCentsPerSqFt)} per square foot, up to ${v.maxSqFt} square feet`,
    change: "FIXED_JAN_1",
    fields: [
      moneyField("rateCentsPerSqFt", "Per square foot ($)", 100000),
      integerField("maxSqFt", "Most square feet counted", 0, 10000),
    ],
    watch: "https://www.irs.gov/businesses/small-businesses-self-employed/simplified-option-for-home-office-deduction",
  }),
  "us.class_life_months": defineRule({
    key: "us.class_life_months",
    title: "Equipment class lives",
    explain: "How many months each kind of equipment is written off over. The rental-appliance life is the expected 5-year class (asset class 57.0) — the CPA confirms it (DQ-TAXBEN-CLASS).",
    area: "FEDERAL",
    schema: z.object({
      rentalAppliances: z.number().int().min(1),
      tools: z.number().int().min(1),
    }),
    describe: (v: { rentalAppliances: number; tools: number }) =>
      `Rental appliances ${v.rentalAppliances} months; tools ${v.tools} months`,
    change: "ANY_DATE",
    fields: [
      integerField("rentalAppliances", "Rental appliances (months)", 1, 600),
      integerField("tools", "Tools (months)", 1, 600),
    ],
    watch: "https://www.irs.gov/publications/p946",
  }),
  "us.passenger_auto_caps": defineRule({
    key: "us.passenger_auto_caps",
    title: "Passenger car first-year caps",
    explain: "The most first-year depreciation a passenger car (or a truck at or under 6,000 lb GVWR) can take, with and without bonus depreciation. Heavier trucks are not capped.",
    area: "FEDERAL",
    schema: z.object({
      year1WithBonusCents: z.number().int().min(0),
      year1WithoutBonusCents: z.number().int().min(0),
    }),
    describe: (v: { year1WithBonusCents: number; year1WithoutBonusCents: number }) =>
      `First year up to ${formatMoney(v.year1WithBonusCents)} with bonus, ${formatMoney(v.year1WithoutBonusCents)} without`,
    change: "FIXED_JAN_1",
    fields: [
      moneyField("year1WithBonusCents", "First-year cap with bonus ($)", 100000000),
      moneyField("year1WithoutBonusCents", "First-year cap without bonus ($)", 100000000),
    ],
    watch: "https://www.irs.gov/publications/p946",
  }),
  "co.enterprise_zone_credit": defineRule({
    key: "co.enterprise_zone_credit",
    title: "Colorado enterprise zone investment credit",
    explain: "Colorado's credit on equipment bought for use in an enterprise zone. The business must pre-certify BEFORE buying — property bought first does not qualify.",
    area: "STATE_INCOME",
    schema: z.object({ percent: z.number().min(0).max(100) }),
    describe: (v: { percent: number }) => `${v.percent}% of qualified investment, pre-certified before purchase`,
    change: "FIXED_JAN_1",
    fields: [percentField("percent", "Credit (%)")],
    watch: "https://oedit.colorado.gov/enterprise-zone",
  }),
  "co.bpp_exemption": defineRule({
    key: "co.bpp_exemption",
    title: "Colorado business personal property exemption",
    explain: "If the actual value of the business's personal property in a county is at or under this amount, it is exempt from Colorado property tax for the year.",
    area: "PROPERTY_TAX",
    schema: z.number().int().min(0),
    describe: (v: number) => `${formatMoney(v)} of actual value per county`,
    change: "FIXED_JAN_1",
    fields: [moneyField("value", "Exemption ($)", 100000000)],
    watch: "https://dpt.colorado.gov/personal-property",
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
  "records.refrigerant_keep_years": defineRule({
    key: "records.refrigerant_keep_years",
    title: "Years to keep refrigerant records",
    explain: "How long to keep the signed statement that the refrigerant was removed before an appliance was scrapped. The federal rule asks for 3 years; 6 matches your tax records.",
    area: "RECORDS",
    schema: z.number().int().min(1).max(30),
    describe: (v: number) => `${v} years`,
    change: "ANY_DATE",
    fields: [integerField("value", "Years to keep", 1, 30)],
  }),
  "co.breach_notice_days": defineRule({
    key: "co.breach_notice_days",
    title: "Days to tell people about a data leak",
    explain: "Colorado gives you this many days, counted from the day you decide customer information really was exposed, to notify the people affected.",
    area: "RECORDS",
    schema: z.number().int().min(1).max(365),
    describe: (v: number) => `${v} days`,
    change: "ANY_DATE",
    fields: [integerField("value", "Days to notify people", 1, 365)],
  }),
  "co.breach_ag_threshold": defineRule({
    key: "co.breach_ag_threshold",
    title: "Leak size that also needs the Attorney General",
    explain: "When at least this many Colorado residents are affected, the state Attorney General must be told as well.",
    area: "RECORDS",
    schema: z.number().int().min(1),
    describe: (v: number) => `${v} or more people`,
    change: "ANY_DATE",
    fields: [integerField("value", "Number of people", 1, 1000000)],
  }),
  "co.breach_bureau_threshold": defineRule({
    key: "co.breach_bureau_threshold",
    title: "Leak size that also needs the credit bureaus",
    explain: "When more than this many Colorado residents are affected, the national credit bureaus must be told as well.",
    area: "RECORDS",
    schema: z.number().int().min(1),
    describe: (v: number) => `more than ${v} people`,
    change: "ANY_DATE",
    fields: [integerField("value", "Number of people", 1, 1000000)],
  }),
  "co.accessibility_fix_days": defineRule({
    key: "co.accessibility_fix_days",
    title: "Days to fix an accessibility complaint",
    explain: "When someone reports the website or app is hard to use, a small business that fixes it within this many days owes a reduced amount.",
    area: "RECORDS",
    schema: z.number().int().min(1).max(365),
    describe: (v: number) => `${v} days`,
    change: "ANY_DATE",
    fields: [integerField("value", "Days to fix", 1, 365)],
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
    watch: "https://greeleyco.gov/business/business-operations/sales-tax/",
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
