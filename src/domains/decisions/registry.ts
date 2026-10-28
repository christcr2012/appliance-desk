import type { Prisma } from "@prisma/client";
import type { TaxChargeCategory } from "@/domains/tax/categories";
import {
  GREELEY_CELL_CATEGORIES,
  GREELEY_JURISDICTION_WHERE,
  STATE_CELL_CATEGORIES,
  taxCellSubjectId,
  type TaxCellScope,
} from "./tax-cells";
import {
  RDF_DECISION_VALUES,
  RDF_HANDLING_VALUES,
  LEASE_ELECTION_VALUES,
  REPORTING_BASIS_VALUES,
  taxPolicyValueProblem,
  reportingBasisProblem,
  taxabilityProblem,
} from "@/domains/tax/policy-values";
import { badDebtTaxRecoveryProblem } from "@/domains/books/bad-debt-policy";
import { setupTaxPlanningProblem } from "@/domains/billing/setup-tax-planning";
import { retentionYearsProblem } from "@/domains/tax/retention-rules";
import { validateTrustedDeviceDays } from "@/domains/security/trusted-devices";
import { STARTING_VALUES, isNoSource } from "./starting-values-data";

/**
 * Decisions & reviews registry (DEC-1a, docs/build-specs/engines/DECISIONS-CENTER.md section 2). One entry per open
 * business, tax, legal or wording decision. Each entry reads its value from the real setting and saves through that
 * setting's own domain save (its `…InTx` form), so locks, owner checks, audit rows and history are the same as on the
 * setting's own screen. Nothing here writes a table directly. `recommended` stays null until DEC-2 fills in the
 * researched starting values (docs/research/2026-10-25-open-decisions.md).
 *
 * Domain modules are imported inside `write` (not at the top) so this file stays light and free of import cycles.
 */
export type Audience = "OWNER" | "CPA" | "ATTORNEY" | "TRANSLATOR";
export const AUDIENCES: Audience[] = ["OWNER", "CPA", "ATTORNEY", "TRANSLATOR"];
export type DecisionArea = "TAX" | "RENTAL_TERMS" | "MONEY" | "PRIVACY" | "WORDING" | "BUSINESS";
export const DECISION_AREAS: DecisionArea[] = ["TAX", "RENTAL_TERMS", "MONEY", "PRIVACY", "WORDING", "BUSINESS"];
export type DecisionOption = { value: Prisma.JsonValue; label: string };
export type DecisionSourceRef = { title: string; url: string; checkedOn: string };

/** Everything the registry reads, loaded once per request (settings row once, tax tables once). */
export type DecisionContext = {
  settings: {
    shortTermLeaseElection: string;
    rdfHandling: string;
    retailDeliveryFeeDecision: string;
    badDebtTaxRecovery: string;
    setupFeeTaxPlanningTreatment: string;
    setupFeeTaxTreatment: string;
    recordRetentionYears: number;
    trustedDeviceDays: number;
    /** The flat late fee new agreements start with (cents). Optional: older callers and tests leave it out. */
    lateFeeFlatCents?: number;
  };
  taxCells: { jurisdictionId: string | null; category: TaxChargeCategory; taxability: string; provisional: boolean }[];
  greeleyJurisdictionId: string | null;
  /** Greeley's city rate in thousandths of a percent (4110 = 4.11%) as of today; null before the area exists. */
  greeleyRateMilliPercent?: number | null;
  filingBases: string[];
};

/** What kind of save this is; a subject may save differently (a tax starting value is saved as provisional). */
export type DecisionWriteKind = "CHANGED" | "CONFIRMED" | "PROFESSIONAL_ANSWER" | "STARTING_VALUE_APPLIED";
export type DecisionWriteMeta = {
  kind: DecisionWriteKind;
  /** The day the answer was confirmed: the professional's answer date, or today for the owner. */
  confirmedOn: Date;
  /** Plain words kept with the setting's own history (who decided and why). */
  reason: string;
  sources: DecisionSourceRef[];
  /** When a scheduled change starts (its history row starts then); today for a change that applies now. */
  effectiveFrom: Date;
  /** The value the setting had when the decision screen was read (compare-and-set saves need it). */
  previousValue: Prisma.JsonValue;
  /**
   * ACCT-1: true ONLY when this write is an accountant's professional answer to a CPA question,
   * recorded through Decisions & reviews on screen. recordProfessionalAnswer sets it after checking,
   * inside the same transaction, that the actor is an active accountant and the question's audience
   * is CPA. The setting saves below accept an ACCOUNTANT actor only when this flag is set; every
   * other caller leaves it unset and stays owner-only.
   */
  professionalAnswer?: boolean;
};

export type DecisionSubject = {
  id: string;
  legacyIds: string[];
  area: DecisionArea;
  audience: Audience;
  title: string;
  question: string;
  facts: string;
  options: DecisionOption[];
  allowOther: boolean;
  /** The stored settings this subject decides, as "Model.field" (tests check every UNDECIDED-capable field is covered). */
  covers: string[];
  read: (ctx: DecisionContext) => Promise<Prisma.JsonValue>;
  write: (tx: Prisma.TransactionClient, actorId: string, value: Prisma.JsonValue, effectiveFrom: Date | null,
    meta: DecisionWriteMeta) => Promise<void>;
  /**
   * When saving the value the setting already has still changes something (a provisional tax value becomes confirmed;
   * a CPA's answer records its date). Absent: an unchanged value is recorded but not saved again.
   */
  confirmWrite?: (ctx: DecisionContext, kind: DecisionWriteKind) => boolean;
  /** The setting's own validator: a plain-words problem, or null when the setting accepts the value. */
  validate: (value: Prisma.JsonValue) => string | null;
  describe: (value: Prisma.JsonValue) => string;
  /** Runs after the transaction commits (e.g. re-check purchases waiting on use tax). */
  afterCommit?: () => Promise<void>;
  recommended: {
    value: Prisma.JsonValue; why: string; sources: DecisionSourceRef[];
    /** CONFIRMED when the owner already answered this question (DEC-2); otherwise a starting value. */
    kind?: "STARTING_VALUE_APPLIED" | "CONFIRMED";
  } | null;
  /** For a setting whose untouched default is not "UNDECIDED" (e.g. the late fee amount starts at 0). */
  untouchedDefault?: Prisma.JsonValue;
  /** YES: bills and returns use the value. ESTIMATE_ONLY: shown as "Estimate — your CPA confirms"; nothing is filed from it. */
  liveUse?: "YES" | "ESTIMATE_ONLY";
  affects: { label: string; href: string }[];
  reviewGate?: string;
};

export const BUSINESS_FACTS =
  "Robinson Appliance Rentals is a new, one-owner business in Greeley (Weld County), Colorado. It rents household " +
  "appliances (washers, dryers, refrigerators, ranges) to homes and property managers, usually month to month or " +
  "for 6 or 12 months, delivers and installs them with its own truck, and sometimes sells used appliances and parts.";

function label(options: DecisionOption[], value: Prisma.JsonValue, fallback: string) {
  return options.find((option) => option.value === value)?.label ?? fallback;
}

// ---------------------------------------------------------------------------------------------------------------
// Taxable or not, per charge (IN-33 Greeley rent, IN-34 every other charge), state defaults and Greeley.

const CATEGORY_WORDS: Record<TaxChargeCategory, string> = {
  ADMINISTRATIVE_SETUP: "the setup fee",
  RENTAL: "monthly rent",
  LATE_RETURN: "rent for keeping an appliance past the end date",
  DELIVERY: "delivery charges",
  INSTALLATION: "installation charges",
  REMOVAL: "removal and haul-away charges",
  DAMAGE_WAIVER: "the damage waiver",
  EARLY_TERMINATION: "the early ending fee",
  LATE_PAYMENT_FEE: "late payment fees",
  OTHER_CHARGE: "other charges on a bill",
  MERCHANDISE: "parts and items sold",
  USED_APPLIANCE_SALE: "used appliances sold",
};

const TAXABILITY_OPTIONS: DecisionOption[] = [
  { value: "TAXABLE", label: "Charge sales tax on it" },
  { value: "EXEMPT", label: "Don't charge sales tax on it" },
];

function describeTaxability(value: Prisma.JsonValue) {
  return value === "TAXABLE" ? "Sales tax is charged"
    : value === "EXEMPT" ? "No sales tax is charged"
      : "Not decided yet — the app won't put this charge on a bill with tax until it is";
}

function cellOf(ctx: DecisionContext, scope: TaxCellScope, category: TaxChargeCategory) {
  const jurisdictionId = scope === "STATE" ? null : ctx.greeleyJurisdictionId;
  if (scope === "GREELEY" && !jurisdictionId) return null;
  return ctx.taxCells.find((cell) => cell.jurisdictionId === jurisdictionId && cell.category === category) ?? null;
}

async function greeleyId(tx: Prisma.TransactionClient): Promise<string> {
  const row = await tx.taxJurisdiction.findFirst({
    where: GREELEY_JURISDICTION_WHERE, select: { id: true }, orderBy: { id: "asc" },
  });
  if (!row) throw new Error("Greeley's tax area isn't set up yet. It appears after the first Greeley address is looked up (Taxes › Tax areas).");
  return row.id;
}

function taxCellSubject(scope: TaxCellScope, category: TaxChargeCategory): DecisionSubject {
  const words = CATEGORY_WORDS[category];
  const where = scope === "STATE" ? "Colorado and the areas the state collects for" : "the City of Greeley";
  const id = taxCellSubjectId({ scope, category });
  return {
    id,
    legacyIds: scope === "GREELEY" && category === "RENTAL" ? ["IN-33"] : ["IN-34"],
    area: "TAX",
    audience: "CPA",
    title: `Tax on ${words} — ${scope === "STATE" ? "Colorado" : "Greeley"}`,
    question: `Should the business charge ${where} sales tax on ${words}?`,
    facts: BUSINESS_FACTS + (scope === "GREELEY"
      ? " Greeley is a home-rule city that collects its own sales tax, separately from the state."
      : " The state, Weld County and the special districts are paid through one state return."),
    options: TAXABILITY_OPTIONS,
    allowOther: true,
    covers: ["TaxabilityRule.taxability"],
    read: async (ctx) => cellOf(ctx, scope, category)?.taxability ?? "UNDECIDED",
    write: async (tx, actorId, value, _effectiveFrom, meta) => {
      const taxability = value === "TAXABLE" || value === "EXEMPT" ? value : null;
      if (!taxability) throw new Error("Choose taxable or not taxable.");
      const jurisdictionId = scope === "STATE" ? null : await greeleyId(tx);
      const setup = await import("@/domains/tax/setup");
      const opts = { effectiveFrom: meta.effectiveFrom, professionalAnswer: meta.professionalAnswer === true };
      // The tax setup save keeps reasons to one plain line.
      const reason = meta.reason.replace(/[\r\n<>]+/g, " ").trim().slice(0, 500) || "Decided in Decisions & reviews";
      if (meta.kind === "STARTING_VALUE_APPLIED") {
        await setup.saveProvisionalTaxabilityCellInTx(tx, actorId, {
          jurisdictionId, category, taxability, reason, sources: meta.sources,
        }, opts);
      } else {
        await setup.saveTaxabilityCellInTx(tx, actorId, {
          jurisdictionId, category, taxability, cpaConfirmedOn: meta.confirmedOn, reason,
        }, opts);
      }
    },
    // Keeping or re-choosing the same value saves again only to confirm a provisional starting value (so a CPA's
    // earlier date is never replaced by the owner's); a professional's answer always records its date.
    confirmWrite: (ctx, kind) => kind === "PROFESSIONAL_ANSWER" || cellOf(ctx, scope, category)?.provisional === true,
    validate: (value) => taxabilityProblem(value),
    describe: describeTaxability,
    recommended: null,
    affects: [
      { label: "What gets taxed", href: "/desk/sales-tax/taxability" },
      { label: "Bills", href: "/desk/billing" },
    ],
    reviewGate: "A CPA date on the tax rule (TaxabilityRule.cpaConfirmedOn) for real business use",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Tax settings with one stored value each.

const LEASE_OPTIONS: DecisionOption[] = [
  { value: "PAY_ON_ACQUISITION", label: "Pay tax when buying each appliance; rent of 3 years or less is then not taxed" },
  { value: "COLLECT_ON_RENTALS", label: "Collect sales tax on rent instead (needs the state's permission first)" },
];
const RDF_HANDLING_OPTIONS: DecisionOption[] = [
  { value: "PAY_MYSELF", label: "The business pays any delivery fee itself" },
  { value: "COLLECT_FROM_CUSTOMER", label: "Add the delivery fee to the customer's bill" },
];
const RDF_DECISION_OPTIONS: DecisionOption[] = [
  { value: "NOT_LIABLE", label: "The business doesn't owe Colorado's retail delivery fee" },
  { value: "COLLECT", label: "The business owes it" },
];
const BASIS_OPTIONS: DecisionOption[] = [
  { value: "ACCRUAL", label: "Report tax when it is billed (accrual)" },
  { value: "CASH", label: "Report tax when it is paid (cash)" },
];
const BAD_DEBT_OPTIONS: DecisionOption[] = [
  { value: "NO", label: "No — keep the tax already reported" },
  { value: "YES", label: "Yes — take back the tax on bills written off" },
];
const SETUP_PLANNING_OPTIONS: DecisionOption[] = [
  { value: "TAXABLE", label: "The setup fee is taxed" },
  { value: "NOT_TAXABLE", label: "The setup fee is not taxed" },
];
const RETENTION_OPTIONS: DecisionOption[] = [5, 7, 10].map((years) => ({
  value: years, label: `${years} years after the appliance leaves the fleet`,
}));

const ELECTION_SUBJECT: DecisionSubject = {
  id: "IN-33-ELECTION",
  legacyIds: ["IN-33"],
  area: "TAX",
  audience: "CPA",
  title: "Tax on rent: pay when buying, or collect on rent",
  question: "For rentals of 3 years or less, should the business pay sales tax when it buys each appliance (rent is then " +
    "not taxed by the state), or collect sales tax on the rent instead?",
  facts: BUSINESS_FACTS + " Colorado lets a lessor collect on rent instead only with the Department of Revenue's " +
    "permission filed before the appliances are bought.",
  options: LEASE_OPTIONS,
  allowOther: true,
  covers: ["BusinessSettings.shortTermLeaseElection"],
  read: async (ctx) => ctx.settings.shortTermLeaseElection,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveTaxPolicyChoiceInTx } = await import("@/domains/tax/policy-choices");
    await saveTaxPolicyChoiceInTx(tx, actorId, "shortTermLeaseElection", String(value), meta.professionalAnswer);
  },
  validate: (value) => taxPolicyValueProblem("shortTermLeaseElection", value),
  describe: (value) => value === "UNDECIDED" ? "Not decided yet — rent can't be billed with tax until it is"
    : label(LEASE_OPTIONS, value, "Unknown"),
  afterCommit: async () => {
    const { afterTaxPolicyChange } = await import("@/domains/tax/policy-choices");
    await afterTaxPolicyChange("shortTermLeaseElection");
  },
  recommended: null,
  affects: [
    { label: "Tax setup", href: "/desk/sales-tax/setup" },
    { label: "Use tax on purchases", href: "/desk/sales-tax/use-tax" },
  ],
};

const RDF_HANDLING_SUBJECT: DecisionSubject = {
  id: "IN-37-RDF",
  legacyIds: ["IN-37"],
  area: "TAX",
  audience: "CPA",
  title: "Colorado retail delivery fee: who pays it",
  question: "If a delivery owes Colorado's retail delivery fee, should the business pay it itself or add it to the customer's bill?",
  facts: BUSINESS_FACTS + " A business with no Colorado retail sales in the year before is exempt until its sales pass $500,000 a year.",
  options: RDF_HANDLING_OPTIONS,
  allowOther: true,
  covers: ["BusinessSettings.rdfHandling"],
  read: async (ctx) => ctx.settings.rdfHandling,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveTaxPolicyChoiceInTx } = await import("@/domains/tax/policy-choices");
    await saveTaxPolicyChoiceInTx(tx, actorId, "rdfHandling", String(value), meta.professionalAnswer);
  },
  validate: (value) => taxPolicyValueProblem("rdfHandling", value),
  describe: (value) => value === "UNDECIDED" ? "Not decided yet" : label(RDF_HANDLING_OPTIONS, value, "Unknown"),
  recommended: null,
  affects: [{ label: "Delivery fees", href: "/desk/sales-tax/delivery-fees" }],
};

const RDF_DECISION_SUBJECT: DecisionSubject = {
  id: "IN-37-RDF-OWED",
  legacyIds: ["IN-37"],
  area: "TAX",
  audience: "CPA",
  title: "Does the business owe Colorado's retail delivery fee?",
  question: "Does the business owe Colorado's retail delivery fee on its deliveries right now?",
  facts: BUSINESS_FACTS + " The app records the answer; it does not add the fee to bills by itself.",
  options: RDF_DECISION_OPTIONS,
  allowOther: true,
  covers: ["BusinessSettings.retailDeliveryFeeDecision"],
  read: async (ctx) => ctx.settings.retailDeliveryFeeDecision,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveTaxPolicyChoiceInTx } = await import("@/domains/tax/policy-choices");
    await saveTaxPolicyChoiceInTx(tx, actorId, "retailDeliveryFeeDecision", String(value), meta.professionalAnswer);
  },
  validate: (value) => taxPolicyValueProblem("retailDeliveryFeeDecision", value),
  describe: (value) => value === "UNDECIDED" ? "Not decided yet" : label(RDF_DECISION_OPTIONS, value, "Unknown"),
  recommended: null,
  affects: [{ label: "Delivery fees", href: "/desk/sales-tax/delivery-fees" }],
};

const BASIS_SUBJECT: DecisionSubject = {
  id: "IN-35-BASIS",
  legacyIds: ["IN-35"],
  area: "TAX",
  audience: "CPA",
  title: "Report sales tax when billed or when paid",
  question: "Should the business's sales tax returns report tax when a bill is sent (accrual) or when the customer pays (cash)?",
  facts: BUSINESS_FACTS + " Most customers pay monthly by card or bank transfer.",
  options: BASIS_OPTIONS,
  allowOther: true,
  covers: ["TaxFilingAccount.basis"],
  read: async (ctx) => {
    const bases = [...new Set(ctx.filingBases)];
    if (bases.length === 0) return "UNDECIDED";
    return bases.length === 1 ? bases[0]! : "MIXED";
  },
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveFilingBasisForAllAccountsInTx } = await import("@/domains/tax/policy-choices");
    await saveFilingBasisForAllAccountsInTx(tx, actorId, String(value), meta.professionalAnswer);
  },
  validate: (value) => reportingBasisProblem(value),
  describe: (value) => value === "UNDECIDED" ? "Not decided yet (or no tax filing account yet)"
    : value === "MIXED" ? "Different on different filing accounts" : label(BASIS_OPTIONS, value, "Unknown"),
  recommended: null,
  affects: [
    { label: "Tax setup", href: "/desk/sales-tax/setup" },
    { label: "Tax returns", href: "/desk/sales-tax/returns" },
  ],
};

const BAD_DEBT_SUBJECT: DecisionSubject = {
  id: "IN-39-BADDEBT",
  legacyIds: ["IN-39"],
  area: "TAX",
  audience: "CPA",
  title: "Take back sales tax on bills that are never paid",
  question: "When a bill is written off as never going to be paid, should the business take back the sales tax it already reported on it?",
  facts: BUSINESS_FACTS,
  options: BAD_DEBT_OPTIONS,
  allowOther: true,
  covers: ["BusinessSettings.badDebtTaxRecovery"],
  read: async (ctx) => ctx.settings.badDebtTaxRecovery,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveBadDebtTaxRecoveryInTx } = await import("@/domains/books/bad-debt-policy");
    await saveBadDebtTaxRecoveryInTx(tx, actorId, String(value), meta.professionalAnswer);
  },
  validate: (value) => badDebtTaxRecoveryProblem(value),
  describe: (value) => value === "UNDECIDED" ? "Not decided yet — write-offs with tax wait in Books until it is"
    : label(BAD_DEBT_OPTIONS, value, "Unknown"),
  recommended: null,
  affects: [{ label: "Books", href: "/desk/books" }],
};

const SETUP_FEE_SUBJECT: DecisionSubject = {
  id: "IN-79",
  legacyIds: ["IN-79"],
  area: "TAX",
  audience: "CPA",
  title: "Is the setup fee taxed?",
  question: "Is the required administrative setup fee charged when a rental starts subject to sales tax?",
  facts: BUSINESS_FACTS + " Every new rental pays a required setup fee (starting value $45).",
  options: SETUP_PLANNING_OPTIONS,
  allowOther: true,
  covers: ["BusinessSettings.setupFeeTaxPlanningTreatment", "BusinessSettings.setupFeeTaxTreatment"],
  read: async (ctx) => ctx.settings.setupFeeTaxPlanningTreatment,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveSetupTaxPlanningInTx } = await import("@/domains/billing/setup-tax-planning");
    await saveSetupTaxPlanningInTx(tx, actorId, String(value), meta.professionalAnswer);
  },
  validate: (value) => setupTaxPlanningProblem(value),
  describe: (value) => label(SETUP_PLANNING_OPTIONS, value, "Unknown"),
  recommended: null,
  affects: [{ label: "Settings", href: "/desk/settings" }],
  reviewGate: "Setup-fee tax approval with the CPA's reference (Settings › Signing charges) for real business use",
};

const RETENTION_SUBJECT: DecisionSubject = {
  id: "IN-71",
  legacyIds: ["IN-71"],
  area: "TAX",
  audience: "CPA",
  title: "How long to keep tax records",
  question: "How many years after an appliance leaves the fleet should its purchase receipts and tax records be kept?",
  facts: BUSINESS_FACTS,
  options: RETENTION_OPTIONS,
  allowOther: true,
  covers: ["LegalRuleVersion:records.keep_years"],
  read: async (ctx) => ctx.settings.recordRetentionYears,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    const { saveRecordRetentionYearsInTx } = await import("@/domains/tax/retention");
    await saveRecordRetentionYearsInTx(tx, actorId, Number(value), Number(meta.previousValue), meta.professionalAnswer);
  },
  validate: (value) => retentionYearsProblem(value),
  describe: (value) => typeof value === "number" ? `${value} years after the appliance leaves the fleet` : "Unknown",
  recommended: null,
  affects: [{ label: "How long tax records are kept", href: "/desk/sales-tax/record-retention" }],
};

const TRUSTED_DEVICE_DAYS_OPTIONS: DecisionOption[] = [0, 7, 14, 30, 60, 90].map((days) => ({
  value: days,
  label: days === 0 ? "Always ask for the code" : `Remember for ${days} days`,
}));

const TRUSTED_DEVICE_DAYS_SUBJECT: DecisionSubject = {
  id: "TRUSTED-DEVICE-DAYS",
  legacyIds: ["TRUSTED-DEVICE-DAYS"],
  area: "BUSINESS",
  audience: "OWNER",
  title: "How long a remembered device skips the code",
  question: "When someone ticks \"Remember this device\" at sign-in, for how many days should the app skip the code on that device?",
  facts: BUSINESS_FACTS,
  options: TRUSTED_DEVICE_DAYS_OPTIONS,
  allowOther: true,
  covers: ["BusinessSettings.trustedDeviceDays"],
  read: async (ctx) => ctx.settings.trustedDeviceDays,
  write: async (tx, actorId, value) => {
    const { updateTrustedDeviceSettingsInTx } = await import("@/domains/security/trusted-devices");
    await updateTrustedDeviceSettingsInTx(tx, actorId, Number(value));
  },
  validate: (value) => {
    try {
      validateTrustedDeviceDays(value);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "That number of days is not allowed.";
    }
  },
  describe: (value) => typeof value === "number"
    ? (value === 0 ? "Always ask for the code" : `Remember for ${value} days`)
    : "Unknown",
  // ACC-6: the 30-day starting value lives in the setting itself and on the Settings screen, and Chris approved
  // 30 days on 2026-10-25. `recommended` stays null until DEC-2 adds researched values with sources.
  recommended: null,
  affects: [{ label: "Settings", href: "/desk/settings" }, { label: "My account", href: "/desk/account" }],
};


const LATE_FEE_OPTIONS: DecisionOption[] = [0, 500, 1000, 1500].map((cents) => ({
  value: cents, label: cents === 0 ? "No late fee" : `$${cents / 100} once per overdue bill`,
}));

const LATE_FEE_AMOUNT_SUBJECT: DecisionSubject = {
  id: "LATE-FEE-AMOUNT",
  legacyIds: ["IN-84"],
  area: "MONEY",
  audience: "OWNER",
  title: "Late fee amount on new rental agreements",
  question: "How much should a new rental agreement charge as a late fee when a bill is more than 10 days late?",
  facts: BUSINESS_FACTS + " Colorado's rule: a late fee only after 10 days late, never more than $15, once per bill, and only after " +
    "the customer was told. Agreements already signed keep the fee they show; a change only applies to agreements made from then on.",
  options: LATE_FEE_OPTIONS,
  allowOther: false,
  covers: ["BusinessSettings.lateFeeFlatCents"],
  untouchedDefault: 0,
  read: async (ctx) => ctx.settings.lateFeeFlatCents ?? 0,
  write: async (tx, actorId, value) => {
    const { updateBusinessSettingsInTx } = await import("@/domains/settings");
    await updateBusinessSettingsInTx(tx, actorId, { lateFeeFlatCents: Number(value) });
  },
  validate: (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 1500
    ? null : "A late fee can be at most $15.",
  describe: (value) => typeof value === "number" ? (value === 0 ? "No late fee" : `$${value / 100} once per overdue bill`) : "Unknown",
  recommended: null,
  affects: [{ label: "Settings", href: "/desk/settings" }, { label: "New rental agreements", href: "/desk/agreements/new" }],
};

const GREELEY_RATE_OPTIONS: DecisionOption[] = [
  { value: 4110, label: "No change — Greeley's city rate stays 4.11%" },
  { value: 4710, label: "Measure 2F passed — the city rate becomes 4.71% (4.11% + 0.6%)" },
];

function describeRate(value: Prisma.JsonValue) {
  return typeof value === "number" ? `Greeley's city rate is ${(value / 1000).toFixed(2)}%` : "Greeley's tax area isn't set up yet";
}

const GREELEY_RATE_SUBJECT: DecisionSubject = {
  id: "GREELEY-RATE-2F",
  legacyIds: [],
  area: "TAX",
  audience: "OWNER",
  title: "Did Greeley's ballot measure 2F pass, changing the city rate?",
  question: "Did Greeley's ballot measure 2F pass, changing the city sales tax rate?",
  facts: BUSINESS_FACTS + " Measure 2F (+0.6%) is on the 3 November 2026 ballot. A new rate starts on the date you choose " +
    "and only applies to bills made from then on; bills already sent are never changed. Pick \"Other\" for any rate not listed.",
  options: GREELEY_RATE_OPTIONS,
  allowOther: true,
  covers: ["TaxRateVersion.rateMilliPercent"],
  read: async (ctx) => ctx.greeleyRateMilliPercent ?? null,
  write: async (tx, actorId, value, _effectiveFrom, meta) => {
    if (typeof value !== "number") throw new Error("Choose a rate.");
    const jurisdictionId = await greeleyId(tx);
    const setup = await import("@/domains/tax/setup");
    await setup.addManualTaxRateVersionInTx(tx, actorId, {
      jurisdictionId, effectiveFrom: meta.effectiveFrom, rateMilliPercent: value,
      sourceNote: meta.reason.replace(/[\r\n<>]+/g, " ").trim().slice(0, 500) || "Decided in Decisions & reviews",
    });
  },
  validate: (value) => typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 15_000
    ? null : "Enter a city rate between 0% and 15%.",
  describe: describeRate,
  recommended: null,
  affects: [{ label: "Tax rates", href: "/desk/sales-tax/areas" }],
};

// ---------------------------------------------------------------------------------------------------------------
// Answers the app follows in its code (no stored setting): the only option is "keep what the app does now". Any
// other answer is recorded and turned into a change to the app by the coding agent (spec section 4, "Other").

const AS_BUILT = "AS_BUILT";

function asBuiltSubject(input: {
  id: string; legacyIds: string[]; area: DecisionArea; audience: Audience; title: string; question: string;
  facts?: string; doingNow: string; affects: { label: string; href: string }[];
}): DecisionSubject {
  const options: DecisionOption[] = [{ value: AS_BUILT, label: "Keep what the app does now" }];
  return {
    id: input.id,
    legacyIds: input.legacyIds,
    area: input.area,
    audience: input.audience,
    title: input.title,
    question: input.question,
    facts: input.facts ?? BUSINESS_FACTS,
    options,
    allowOther: true,
    covers: [],
    read: async () => AS_BUILT,
    write: async (_tx, _actorId, value) => {
      if (value !== AS_BUILT) throw new Error("This answer needs a change to the app; it can't be saved as a setting.");
    },
      validate: (value) => value === AS_BUILT ? null : "This answer needs a change to the app.",
    describe: () => input.doingNow,
    recommended: null,
    affects: input.affects,
  };
}

const AS_BUILT_SUBJECTS: DecisionSubject[] = [
  asBuiltSubject({
    id: "IN-44", legacyIds: ["IN-44"], area: "TAX", audience: "CPA",
    title: "Where untaxed rent goes on the state return",
    question: "On the Colorado sales tax return, where should rent that isn't taxed (tax was paid when the appliance was bought) be reported?",
    doingNow: "Untaxed amounts are included in gross sales and then subtracted on the deduction lines the return names",
    affects: [{ label: "Tax returns", href: "/desk/sales-tax/returns" }],
  }),
  asBuiltSubject({
    id: "IN-46", legacyIds: ["IN-46"], area: "TAX", audience: "CPA",
    title: "Tax on parts and used appliances sold",
    question: "How should sales of parts and used appliances be taxed, and should resale stock be bought with tax paid?",
    doingNow: "Picked up at the shop: the shop's tax rate. Delivered: the customer's address rate. Stock for resale is bought with tax paid",
    affects: [{ label: "Sales", href: "/desk/sales" }],
  }),
  asBuiltSubject({
    id: "IN-56", legacyIds: ["IN-56"], area: "TAX", audience: "CPA",
    title: "Retired appliances: book and tax figures",
    question: "When an appliance is retired, is the way the app writes off its remaining value and estimates the tax effect right for the business?",
    doingNow: "Remaining book value is written off once; the tax effect is shown only as an estimate for your CPA",
    affects: [{ label: "Assets", href: "/desk/books/assets" }],
  }),
  asBuiltSubject({
    id: "IN-65", legacyIds: ["IN-65"], area: "TAX", audience: "CPA",
    title: "Use tax credit for tax paid to another state",
    question: "When an appliance was bought out of state with that state's tax paid, how much Colorado and Greeley use tax is still owed?",
    doingNow: "Colorado use tax is reduced by tax paid to the other state (never below zero); Greeley use tax is charged in full",
    affects: [{ label: "Use tax on purchases", href: "/desk/sales-tax/use-tax" }],
  }),
  asBuiltSubject({
    id: "IN-07", legacyIds: ["IN-07"], area: "WORDING", audience: "ATTORNEY",
    title: "Business details and rental terms wording",
    question: "Are the legal business details and the rental terms customers sign worded correctly?",
    doingNow: "The legal details and rental terms approved earlier are used",
    affects: [{ label: "Rental terms", href: "/desk/settings/policies" }],
  }),
  asBuiltSubject({
    id: "IN-21", legacyIds: ["IN-21"], area: "RENTAL_TERMS", audience: "ATTORNEY",
    title: "Month-to-month terms and change notices",
    question: "Is the month-to-month rental wording, including the 30-day notice before a change, right?",
    doingNow: "The month-to-month wording built into the app, with 30 days' notice before a change",
    affects: [{ label: "Rental endings", href: "/desk/settings/rental-endings" }],
  }),
  asBuiltSubject({
    id: "IN-31", legacyIds: ["IN-31"], area: "RENTAL_TERMS", audience: "ATTORNEY",
    title: "How notices are delivered",
    question: "Are the ways the app delivers notices to customers enough, and is the yearly month-to-month reminder right?",
    doingNow: "Mail, email to the customer's own mailbox, a handed copy, or text/app only with text permission (a phone call doesn't count); a yearly reminder 30 days before each rental anniversary",
    affects: [{ label: "Notices", href: "/desk/notices" }],
  }),
  asBuiltSubject({
    id: "IN-38", legacyIds: ["IN-38"], area: "WORDING", audience: "ATTORNEY",
    title: "How the tax rate is shown on agreements",
    question: "Is it right for the agreement and signing page to say \"Sales tax for your address, currently {rate}%\" instead of a fixed rate?",
    doingNow: "Agreements show the tax for the customer's address and today's rate",
    affects: [{ label: "Agreements", href: "/desk/agreements" }],
  }),
  asBuiltSubject({
    id: "IN-52", legacyIds: ["IN-52"], area: "PRIVACY", audience: "ATTORNEY",
    title: "Voicemail greeting and keeping recordings",
    question: "Is the voicemail greeting and keeping recordings for 90 days (transcription off) right for customer privacy?",
    doingNow: "Greeting editable, recordings kept 90 days, transcription off (Chris's answer of 2026-10-13)",
    affects: [{ label: "Phone settings", href: "/desk/settings/telecom" }],
  }),
  asBuiltSubject({
    id: "IN-76", legacyIds: ["IN-76"], area: "RENTAL_TERMS", audience: "ATTORNEY",
    title: "Cancellation refunds wording",
    question: "Is the cancellation refund wording in the rental terms right?",
    doingNow: "Full refund before delivery; larger orders: full refund within 72 hours, then the setup fee is kept; every refund needs the owner's approval (Chris's answer of 2026-10-13)",
    affects: [{ label: "Rental terms", href: "/desk/settings/policies" }],
  }),
  asBuiltSubject({
    id: "IN-78", legacyIds: ["IN-78"], area: "RENTAL_TERMS", audience: "ATTORNEY",
    title: "Property-manager rules",
    question: "Are the rules for property managers renting for their tenants worded correctly?",
    doingNow: "The property-manager rules Chris answered on 2026-10-13",
    affects: [{ label: "Customers", href: "/desk/customers" }],
  }),
  asBuiltSubject({
    id: "IN-83", legacyIds: ["IN-83"], area: "WORDING", audience: "TRANSLATOR",
    title: "Spanish wording review",
    question: "Is the Spanish wording customers see correct and natural?",
    doingNow: "Spanish wording is reviewed by fluent people Chris knows before it is used",
    affects: [{ label: "Spanish wording", href: "/desk/settings" }],
  }),
  asBuiltSubject({
    id: "IN-84", legacyIds: ["IN-84"], area: "RENTAL_TERMS", audience: "ATTORNEY",
    title: "Late fee wording",
    question: "Is the late fee wording in the rental terms right ($5 once per overdue bill, only after it is more than 10 days late, never more than $15)?",
    doingNow: "$5 once per overdue bill after 10 days late, at most $15; the owner or an admin may waive it with a reason",
    affects: [{ label: "Rental terms", href: "/desk/settings/policies" }],
  }),
  asBuiltSubject({
    id: "IN-06", legacyIds: ["IN-06"], area: "BUSINESS", audience: "OWNER",
    title: "Delivery zones and prices",
    question: "Are the delivery zones and prices right?",
    doingNow: "Up to 15 miles free, over 15 to 30 miles $75, over 30 to 50 miles $125, beyond 50 miles pickup only (Chris's answer of 2026-10-13); the zone is found from the address and pickup is always offered (2026-10-25)",
    affects: [{ label: "Delivery zones", href: "/desk/settings?section=service-area" }],
  }),
  // ZONE-1 (docs/build-specs/screens/SERVICE-AREA-MAP.md): starting values filed for confirmation.
  asBuiltSubject({
    id: "ZONE-NAMES", legacyIds: [], area: "WORDING", audience: "OWNER",
    title: "Delivery zone names",
    question: "Are the zone names customers see right: \"Local — free delivery\", \"Nearby\" and \"Extended\"?",
    doingNow: "Starting names: Local — free delivery (0–15 miles), Nearby (over 15–30), Extended (over 30–50); you can rename them in Settings › Delivery zones",
    affects: [{ label: "Delivery zones", href: "/desk/settings?section=service-area" }],
  }),
  asBuiltSubject({
    id: "ZONE-PICKUP-PRICE", legacyIds: [], area: "MONEY", audience: "OWNER",
    title: "Price for picking up at the end of a rental",
    question: "Should our pickup at the end of a rental cost the same as delivery in each zone?",
    doingNow: "Starting value: the same as delivery in each zone (free, $75, $125); you can change each one in Settings › Delivery zones",
    affects: [{ label: "Delivery zones", href: "/desk/settings?section=service-area" }],
  }),
  asBuiltSubject({
    id: "ZONE-DISTANCE", legacyIds: [], area: "BUSINESS", audience: "OWNER",
    title: "How delivery distance is measured",
    question: "Are delivery zones measured in a straight line from the center of Greeley, or by driving distance?",
    doingNow: "Straight line from the center — Chris's answer of 2026-10-25 (\"at least for now, it is better to not use driving distance\"); driving distance stays available as a later option",
    affects: [{ label: "Delivery zones", href: "/desk/settings?section=service-area" }],
  }),
];

/** DEC-2: attach the researched starting value (and say whether a figure from it is only an estimate). */
function withStartingValue(subject: DecisionSubject): DecisionSubject {
  const entry = STARTING_VALUES[subject.id];
  const liveUse = subject.id === "IN-56" ? "ESTIMATE_ONLY" as const : "YES" as const;
  if (!entry || isNoSource(entry)) return { ...subject, recommended: null, liveUse };
  return { ...subject, recommended: entry, liveUse };
}

export const DECISION_SUBJECTS: DecisionSubject[] = [
  ELECTION_SUBJECT,
  ...STATE_CELL_CATEGORIES.map((category) => taxCellSubject("STATE", category)),
  ...GREELEY_CELL_CATEGORIES.map((category) => taxCellSubject("GREELEY", category)),
  BASIS_SUBJECT,
  RDF_HANDLING_SUBJECT,
  RDF_DECISION_SUBJECT,
  BAD_DEBT_SUBJECT,
  SETUP_FEE_SUBJECT,
  RETENTION_SUBJECT,
  TRUSTED_DEVICE_DAYS_SUBJECT,
  GREELEY_RATE_SUBJECT,
  LATE_FEE_AMOUNT_SUBJECT,
  ...AS_BUILT_SUBJECTS,
].map(withStartingValue);

const BY_ID = new Map(DECISION_SUBJECTS.map((subject) => [subject.id, subject]));

export function decisionSubject(id: string): DecisionSubject | null {
  return BY_ID.get(id) ?? null;
}

/** Exposed for tests: the value lists the registry's tax options come from. */
export const REGISTRY_VALUE_LISTS = {
  LEASE_ELECTION_VALUES, RDF_HANDLING_VALUES, RDF_DECISION_VALUES, REPORTING_BASIS_VALUES,
};
