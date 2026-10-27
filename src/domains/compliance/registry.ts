import { businessDateFromKey } from "@/lib/business-date";

/**
 * CMP-1: the compliance obligation registry — a pure module, seeded exactly
 * from docs/research/2026-10-25-federal-colorado-compliance.md (researched
 * 2026-10-25; V = official page read, U = unverified, carried as a Decisions
 * question with a careful starting value). Every obligation knows whether
 * it applies from the owner's facts, which periods it has, and how the app
 * will handle it. Nothing here reads the database or the clock: the filing
 * sync (filings.ts) supplies the facts and the year.
 */

export type ObligationChannel =
  | "DIRECT"
  | "UPLOAD_FILE"
  | "FILLED_FORM"
  | "GUIDED_WEB"
  | "ACCOUNTANT_PACKET";

export type ObligationEffect = "FIXED" | "COSTS" | "BENEFITS";

export type ComplianceUnit = "CMP-1" | "CMP-2" | "CMP-3" | "CMP-4" | "CMP-5";

/** The facts an applies/period decision may use. Supplied by the sync. */
export interface ComplianceContext {
  entityType: string; // SINGLE_MEMBER_LLC | MULTI_MEMBER_LLC | S_CORP
  employees: number;
  truckGvwrLbs: number | null;
  sosReportMonth: number | null; // 1-12
  hasHomeOffice: boolean;
  hasEin: boolean;
  /** Books facts for the period's year, computed by the caller. */
  hasDepreciableAssets: boolean;
  hasAssetSales: boolean;
}

export interface ObligationPeriod {
  periodKey: string;
  opens: Date;
  dueOn: Date;
  effect: ObligationEffect;
}

export interface Obligation {
  key: string;
  title: string;
  agency: string;
  /** Plain words: what this is and how the app handles it. */
  explain: string;
  sourceUrl: string;
  channel: ObligationChannel;
  unit: ComplianceUnit;
  applies: (ctx: ComplianceContext) => { applies: boolean; why: string };
  periods: (year: number, ctx: ComplianceContext) => ObligationPeriod[];
}

const d = (key: string): Date => {
  const date = businessDateFromKey(key);
  if (!date) throw new Error(`Bad registry date: ${key}`);
  return date;
};
const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, day: number) => `${y}-${pad(m)}-${pad(day)}`;

const always = (why: string) => () => ({ applies: true, why });
const whenEmployees = (what: string) => (ctx: ComplianceContext) =>
  ctx.employees > 0
    ? { applies: true, why: `You have ${ctx.employees} employee${ctx.employees === 1 ? "" : "s"}, so ${what} applies.` }
    : { applies: false, why: `No employees yet — ${what} wakes up when you hire.` };

/** The four estimated-tax periods of a tax year (federal and Colorado share the dates). */
function estimatedPeriods(year: number): ObligationPeriod[] {
  return [
    { periodKey: `${year}-Q1`, opens: d(ymd(year, 1, 1)), dueOn: d(ymd(year, 4, 15)), effect: "COSTS" },
    { periodKey: `${year}-Q2`, opens: d(ymd(year, 4, 16)), dueOn: d(ymd(year, 6, 15)), effect: "COSTS" },
    { periodKey: `${year}-Q3`, opens: d(ymd(year, 6, 16)), dueOn: d(ymd(year, 9, 15)), effect: "COSTS" },
    { periodKey: `${year}-Q4`, opens: d(ymd(year, 9, 16)), dueOn: d(ymd(year + 1, 1, 15)), effect: "COSTS" },
  ];
}

/** The annual return window for a tax year, by entity type. */
function returnPeriod(year: number, ctx: ComplianceContext): ObligationPeriod {
  const partnershipOrCorp = ctx.entityType === "MULTI_MEMBER_LLC" || ctx.entityType === "S_CORP";
  return {
    periodKey: `${year}`,
    opens: d(ymd(year + 1, 1, 1)),
    dueOn: partnershipOrCorp ? d(ymd(year + 1, 3, 15)) : d(ymd(year + 1, 4, 15)),
    effect: "COSTS",
  };
}

export const OBLIGATIONS: Obligation[] = [
  {
    key: "fed.income.schedule_c",
    title: "Federal income tax return",
    agency: "IRS",
    explain:
      "Your yearly federal return. A single-member LLC files Schedule C and Schedule SE with Form 1040; a multi-member LLC files Form 1065 and an S-corp files Form 1120-S. The IRS does not let small-business software file returns directly, so the app prepares an accountant packet from your books.",
    sourceUrl:
      "https://www.irs.gov/businesses/small-businesses-self-employed/single-member-limited-liability-companies",
    channel: "ACCOUNTANT_PACKET",
    unit: "CMP-2",
    applies: always("The business files a federal return every year; the form follows the entity type."),
    periods: (year, ctx) => [returnPeriod(year, ctx)],
  },
  {
    key: "fed.estimated_tax",
    title: "Federal estimated tax (Form 1040-ES)",
    agency: "IRS",
    explain:
      "Four estimated payments a year. The app works out each amount by the safe-harbor method from last year's tax (entered once in Business facts) and fills the 1040-ES voucher; you pay at IRS Direct Pay — the app never pays.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1040-es",
    channel: "FILLED_FORM",
    unit: "CMP-2",
    applies: always("A profitable LLC passes its tax to the owner, who pays it in four estimates."),
    periods: (year) => estimatedPeriods(year),
  },
  {
    key: "fed.4562",
    title: "Depreciation (Form 4562)",
    agency: "IRS",
    explain:
      "Reports depreciation and Section 179 for the appliances and equipment placed in service. The app prepares the worksheet from your asset records; your CPA confirms it with the return.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-4562",
    channel: "ACCOUNTANT_PACKET",
    unit: "CMP-2",
    applies: (ctx) =>
      ctx.hasDepreciableAssets
        ? { applies: true, why: "You have appliances or equipment being depreciated." }
        : { applies: false, why: "Nothing is being depreciated yet — this starts with your first rental appliance or equipment purchase." },
    periods: (year, ctx) => [returnPeriod(year, ctx)],
  },
  {
    key: "fed.4797",
    title: "Sale of business property (Form 4797)",
    agency: "IRS",
    explain:
      "Reports the sale of retired rental appliances and other business property (Section 1245). The app prepares the worksheet from the sale records; your CPA confirms it with the return.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-4797",
    channel: "ACCOUNTANT_PACKET",
    unit: "CMP-2",
    applies: (ctx) =>
      ctx.hasAssetSales
        ? { applies: true, why: "You sold business property this year." }
        : { applies: false, why: "No business property was sold this year." },
    periods: (year, ctx) => [returnPeriod(year, ctx)],
  },
  {
    key: "fed.1099_nec",
    title: "1099-NEC for contractors and services",
    agency: "IRS",
    explain:
      "Sent to anyone you paid $2,000 or more for services in a year (the 2026 threshold), and filed with the IRS by January 31. The app prepares the amounts from your books and makes the IRS IRIS upload file; card payments are excluded (the card company reports those).",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-nec",
    channel: "UPLOAD_FILE",
    unit: "CMP-3",
    applies: always("Applies in any year you pay a contractor or service provider $2,000 or more; the app checks your books."),
    periods: (year) => [
      { periodKey: `${year}`, opens: d(ymd(year + 1, 1, 1)), dueOn: d(ymd(year + 1, 1, 31)), effect: "COSTS" },
    ],
  },
  {
    key: "fed.1099_misc",
    title: "1099-MISC for rents and other payments",
    agency: "IRS",
    explain:
      "Reports rents and other miscellaneous payments of $2,000 or more in a year. Copies go to the recipient by January 31 and to the IRS by March 31 when filed electronically; the app prepares both from your books.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-misc",
    channel: "UPLOAD_FILE",
    unit: "CMP-3",
    applies: always("Applies in any year you pay $2,000 or more in rents or other reportable payments; the app checks your books."),
    periods: (year) => [
      { periodKey: `${year}`, opens: d(ymd(year + 1, 1, 1)), dueOn: d(ymd(year + 1, 3, 31)), effect: "COSTS" },
    ],
  },
  {
    key: "fed.1099k_reconcile",
    title: "1099-K check (card payments from Stripe)",
    agency: "IRS",
    explain:
      "Stripe sends a 1099-K when card payments pass $20,000 and 200 transactions in a year. The app ties its amounts to your books so the income on your return matches what Stripe reported.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-1099-k",
    channel: "ACCOUNTANT_PACKET",
    unit: "CMP-2",
    applies: always("You take card payments through Stripe, so a 1099-K may arrive; the check runs either way."),
    periods: (year) => [
      { periodKey: `${year}`, opens: d(ymd(year + 1, 1, 1)), dueOn: d(ymd(year + 1, 1, 31)), effect: "COSTS" },
    ],
  },
  {
    key: "fed.8300",
    title: "Cash payments over $10,000 (Form 8300)",
    agency: "IRS / FinCEN",
    explain:
      "A cash payment over $10,000 (including related payments from the same customer within 12 months) must be reported within 15 days through BSA E-Filing. Card and bank payments are not cash. The app watches for this and prepares the form if it ever happens.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-8300",
    channel: "FILLED_FORM",
    unit: "CMP-3",
    applies: always("Only if a customer ever pays more than $10,000 in cash — the app detects it from recorded payments."),
    // Event-driven, not calendar-driven: the CMP-3 detector creates the
    // filing row directly when a qualifying cash payment is recorded.
    periods: () => [],
  },
  {
    key: "fed.payroll.941",
    title: "Payroll tax return (Form 941)",
    agency: "IRS",
    explain: "Quarterly payroll tax return, due the last day of the month after each quarter. Dormant until you hire.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-941",
    channel: "GUIDED_WEB",
    unit: "CMP-5",
    applies: whenEmployees("payroll tax filing"),
    periods: (year) => [
      { periodKey: `${year}-Q1`, opens: d(ymd(year, 1, 1)), dueOn: d(ymd(year, 4, 30)), effect: "COSTS" },
      { periodKey: `${year}-Q2`, opens: d(ymd(year, 4, 1)), dueOn: d(ymd(year, 7, 31)), effect: "COSTS" },
      { periodKey: `${year}-Q3`, opens: d(ymd(year, 7, 1)), dueOn: d(ymd(year, 10, 31)), effect: "COSTS" },
      { periodKey: `${year}-Q4`, opens: d(ymd(year, 10, 1)), dueOn: d(ymd(year + 1, 1, 31)), effect: "COSTS" },
    ],
  },
  {
    key: "fed.payroll.940",
    title: "Federal unemployment tax (Form 940)",
    agency: "IRS",
    explain: "Yearly federal unemployment (FUTA) return, due January 31. Dormant until you hire.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-940",
    channel: "GUIDED_WEB",
    unit: "CMP-5",
    applies: whenEmployees("federal unemployment tax"),
    periods: (year) => [
      { periodKey: `${year}`, opens: d(ymd(year + 1, 1, 1)), dueOn: d(ymd(year + 1, 1, 31)), effect: "COSTS" },
    ],
  },
  {
    key: "fed.payroll.w2",
    title: "Wage statements (Form W-2)",
    agency: "IRS / Social Security",
    explain: "A W-2 for each employee by January 31, filed with the Social Security Administration. Dormant until you hire.",
    sourceUrl: "https://www.irs.gov/forms-pubs/about-form-w-2",
    channel: "GUIDED_WEB",
    unit: "CMP-5",
    applies: whenEmployees("W-2 filing"),
    periods: (year) => [
      { periodKey: `${year}`, opens: d(ymd(year + 1, 1, 1)), dueOn: d(ymd(year + 1, 1, 31)), effect: "COSTS" },
    ],
  },
  {
    key: "fed.usdot",
    title: "USDOT registration update",
    agency: "FMCSA / Colorado State Patrol",
    explain:
      "Colorado requires a USDOT number for intrastate trucks rated 16,001 lb or more, with a registration update every two years on the FMCSA site.",
    sourceUrl: "https://www.fmcsa.dot.gov/registration",
    channel: "GUIDED_WEB",
    unit: "CMP-4",
    applies: (ctx) =>
      ctx.truckGvwrLbs !== null && ctx.truckGvwrLbs >= 16001
        ? { applies: true, why: `Your truck is rated ${ctx.truckGvwrLbs.toLocaleString("en-US")} lb, at or over the 16,001 lb line.` }
        : {
            applies: false,
            why:
              ctx.truckGvwrLbs === null
                ? "Enter the truck's weight rating in Business facts — a USDOT number is needed only at 16,001 lb or more."
                : `Your truck is rated ${ctx.truckGvwrLbs.toLocaleString("en-US")} lb, under the 16,001 lb line.`,
          },
    periods: (year) => [
      { periodKey: `${year}`, opens: d(ymd(year, 1, 1)), dueOn: d(ymd(year, 12, 31)), effect: "BENEFITS" },
    ],
  },
  {
    key: "co.income.dr0104ep",
    title: "Colorado estimated tax (DR 0104EP)",
    agency: "Colorado Department of Revenue",
    explain:
      "Four estimated payments a year on the same dates as the federal ones. The app fills the DR 0104EP voucher from the same safe-harbor amounts; you pay at Colorado Revenue Online — the app never pays.",
    sourceUrl: "https://tax.colorado.gov/estimated-income-tax",
    channel: "FILLED_FORM",
    unit: "CMP-2",
    applies: (ctx) =>
      ctx.entityType === "S_CORP"
        ? { applies: false, why: "An S-corp files its own Colorado return (DR 0106) instead of the owner's estimated payments." }
        : { applies: true, why: "The owner pays Colorado tax on the LLC's income in four estimates." },
    periods: (year) => estimatedPeriods(year),
  },
  {
    key: "co.bpp.weld_declaration",
    title: "Weld County business property declaration",
    agency: "Weld County Assessor",
    explain:
      "A yearly declaration of the business property you owned on January 1 (appliances, tools, equipment), due April 15. No declaration is needed when the total actual value is $56,000 or less (2026). The app builds it from your asset records and prepares the Weld forms and spreadsheet.",
    sourceUrl: "https://www.weldgov.com/departments/assessor",
    channel: "UPLOAD_FILE",
    unit: "CMP-4",
    applies: always("Starts with the January 1, 2027 assessment — the first January 1 the business owns its rental fleet."),
    periods: (year) =>
      // Researched: the obligation starts with the Jan 1, 2027 assessment.
      year < 2027
        ? []
        : [{ periodKey: `${year}`, opens: d(ymd(year, 1, 2)), dueOn: d(ymd(year, 4, 15)), effect: "COSTS" }],
  },
  {
    key: "co.sos.periodic_report",
    title: "Colorado LLC periodic report",
    agency: "Colorado Secretary of State",
    explain:
      "The LLC's yearly report to the Secretary of State ($25, online only). It can be filed from two months before your report month to two months after; filing late makes the LLC delinquent. The app shows the exact values to type on the SOS site.",
    sourceUrl: "https://www.coloradosos.gov/biz/businessEntityCriteriaExt.do",
    channel: "GUIDED_WEB",
    unit: "CMP-4",
    applies: always("Every Colorado LLC files a periodic report each year."),
    periods: (year, ctx) => {
      if (!ctx.sosReportMonth) return [];
      const m = ctx.sosReportMonth;
      const opensDate = new Date(Date.UTC(year, m - 3, 1)); // two months before the report month
      const closesDate = new Date(Date.UTC(year, m + 2, 0)); // last day of two months after
      return [
        {
          periodKey: `${year}`,
          opens: d(ymd(opensDate.getUTCFullYear(), opensDate.getUTCMonth() + 1, 1)),
          dueOn: d(ymd(closesDate.getUTCFullYear(), closesDate.getUTCMonth() + 1, closesDate.getUTCDate())),
          effect: "COSTS",
        },
      ];
    },
  },
  {
    key: "co.sos.trade_name",
    title: "Trade name renewal",
    agency: "Colorado Secretary of State",
    explain:
      "If the business files under a trade name, the statement of trade name is renewed with the Secretary of State ($5). The exact renewal rule is being confirmed (see Decisions); the reminder dates are set once it is answered.",
    sourceUrl: "https://www.coloradosos.gov/biz/businessEntityCriteriaExt.do",
    channel: "GUIDED_WEB",
    unit: "CMP-4",
    applies: always("Likely applies if you registered a trade name; the renewal rule is unconfirmed."),
    // Renewal rule unverified (research U): no dates until the Decisions
    // answer lands; CMP-4 wires the confirmed rule in.
    periods: () => [],
  },
  {
    key: "greeley.business_license",
    title: "Greeley business license",
    agency: "City of Greeley",
    explain:
      "Every business operating in Greeley needs a city business license, handled on the city's sales tax portal. The fee and renewal dates are being confirmed (see Decisions); the reminder is set once they are answered.",
    sourceUrl: "https://salestax.greeleygov.com",
    channel: "GUIDED_WEB",
    unit: "CMP-4",
    applies: always("The business operates in Greeley, so a city license is required."),
    // Fee/renewal unverified (research U): CMP-4 wires the confirmed dates.
    periods: () => [],
  },
  {
    key: "co.vehicle_registration",
    title: "Truck registration renewal",
    agency: "Colorado DMV / Weld County",
    explain:
      "The delivery truck's registration and specific ownership tax renew every year in its registration month, at the county motor vehicle office. The month comes from the truck's current registration (a Business fact CMP-4 collects).",
    sourceUrl: "https://dmv.colorado.gov/vehicle-registration",
    channel: "GUIDED_WEB",
    unit: "CMP-4",
    applies: (ctx) =>
      ctx.truckGvwrLbs !== null
        ? { applies: true, why: "You run a delivery truck, so its registration renews yearly." }
        : { applies: false, why: "No truck is recorded yet — enter its weight rating in Business facts." },
    // The registration month is collected by CMP-4; no dates until then.
    periods: () => [],
  },
  {
    key: "co.payroll.withholding",
    title: "Colorado payroll withholding",
    agency: "Colorado Department of Revenue",
    explain: "State withholding deposits and returns once you have employees. Dormant until you hire.",
    sourceUrl: "https://tax.colorado.gov/wage-withholding",
    channel: "GUIDED_WEB",
    unit: "CMP-5",
    applies: whenEmployees("Colorado withholding"),
    periods: () => [],
  },
  {
    key: "co.payroll.ui",
    title: "Colorado unemployment insurance",
    agency: "Colorado Department of Labor and Employment",
    explain: "Quarterly unemployment insurance reports and premiums once you have employees (2026 wage base $30,600). Dormant until you hire.",
    sourceUrl: "https://cdle.colorado.gov/unemployment-insurance-for-employers",
    channel: "GUIDED_WEB",
    unit: "CMP-5",
    applies: whenEmployees("unemployment insurance"),
    periods: () => [],
  },
  {
    key: "co.payroll.famli",
    title: "Colorado FAMLI premiums",
    agency: "Colorado FAMLI Division",
    explain:
      "Paid family and medical leave premiums (2026: 0.88% of wages; employers with 9 or fewer employees remit only the employee's 0.44%). Dormant until you hire.",
    sourceUrl: "https://famli.colorado.gov/employers",
    channel: "GUIDED_WEB",
    unit: "CMP-5",
    applies: whenEmployees("FAMLI premiums"),
    periods: () => [],
  },
];

export function obligationByKey(key: string): Obligation | undefined {
  return OBLIGATIONS.find((o) => o.key === key);
}

export interface NotNeededEntry {
  key: string;
  title: string;
  agency: string;
  reason: string;
  sourceUrl: string;
}

/**
 * Checked and not needed — shown on the Compliance screen with the reason
 * and the source, so the owner can see these were considered, not missed.
 */
export function notNeededObligations(ctx: ComplianceContext): NotNeededEntry[] {
  const entries: NotNeededEntry[] = [
    {
      key: "fed.boi",
      title: "Beneficial ownership report (FinCEN)",
      agency: "FinCEN",
      reason: "U.S. companies are exempt from the beneficial ownership report under FinCEN's final rule.",
      sourceUrl: "https://www.fincen.gov/boi",
    },
    {
      key: "co.rent_to_own_license",
      title: "Rent-to-own license",
      agency: "Colorado Attorney General",
      reason:
        "Colorado's rent-to-own law covers only agreements that let the renter become the owner. These rentals have no ownership option, so no license is needed.",
      sourceUrl: "https://leg.colorado.gov",
    },
  ];
  if (ctx.truckGvwrLbs === null || ctx.truckGvwrLbs < 55000) {
    entries.push({
      key: "fed.2290",
      title: "Heavy vehicle tax (Form 2290)",
      agency: "IRS",
      reason:
        ctx.truckGvwrLbs === null
          ? "Form 2290 applies only to vehicles of 55,000 lb or more; no truck that heavy is recorded."
          : `Form 2290 applies only to vehicles of 55,000 lb or more; your truck is rated ${ctx.truckGvwrLbs.toLocaleString("en-US")} lb.`,
      sourceUrl: "https://www.irs.gov/forms-pubs/about-form-2290",
    });
  }
  return entries;
}
