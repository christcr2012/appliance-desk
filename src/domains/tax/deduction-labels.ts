/**
 * W-12 / IN-44 (owner decision 2026-10-31): how non-taxed amounts are
 * reported on the Colorado sales tax return. Chris directed that the most
 * likely outcome of the CPA's review be researched and applied as the
 * configurable default instead of leaving every deduction line "Not
 * decided". The research (docs/research/2026-10-31-in-44-deduction-reporting.md)
 * found every packet bucket is included in gross sales on the DR 0100 and
 * deducted on Schedule A; these are the starting values of
 * TaxFilingAccount.deductionLabels. They are NOT CPA-approved: IN-44 stays
 * open, lines that use them carry the pending provenance below, and the
 * owner can change any bucket in the filing-account settings with no code
 * change. When the CPA answers, their wording replaces these as ordinary
 * owner-saved entries.
 */
export type DeductionReportAs = "DEDUCTION" | "LEAVE_OUT_OF_GROSS";
/**
 * Where a bucket's wording came from. RESEARCHED_DEFAULT carries the
 * pending-CPA provenance; ACCOUNTANT means the business's accountant (the
 * CPA the IN-44 question is addressed to) set or confirmed the wording in
 * the app, so the pending label clears for that bucket.
 */
export type DeductionLabelSource = "OWNER" | "RESEARCHED_DEFAULT" | "ACCOUNTANT";
export type DeductionLabelEntry = {
  label: string;
  reportAs: DeductionReportAs;
  source: DeductionLabelSource;
};

export const CPA_PENDING_LABEL = "Researched default — CPA confirmation still pending";

/** Plain-words provenance line for a settings screen, by source. */
export function deductionSourceNote(source: DeductionLabelSource): string {
  if (source === "RESEARCHED_DEFAULT") return CPA_PENDING_LABEL + ".";
  if (source === "ACCOUNTANT") return "Set by your accountant.";
  return "Your saved wording.";
}

export type ResearchedDeductionDefault = {
  /** The exact wording the packet prints for this deduction line. */
  label: string;
  reportAs: DeductionReportAs;
  /** Schedule A code on the current DR 0100, e.g. "A13-1". */
  scheduleLine: string;
  /** Plain-words name of the bucket for the settings screen. */
  bucketName: string;
  /** Plain-words explanation shown beside the setting. */
  plainWords: string;
  confidence: "HIGH" | "MEDIUM";
};

export const RESEARCHED_DEDUCTION_DEFAULTS: Readonly<Record<string, ResearchedDeductionDefault>> = {
  EXEMPT_SHORT_TERM_RENTAL: {
    label: "A13-1 Other exempt sales — short-term lease, tax paid on acquisition (C.R.S. 39-26-713(1)(a))",
    reportAs: "DEDUCTION",
    scheduleLine: "A13-1",
    bucketName: "Rent that is exempt under the short-term lease rule",
    plainWords:
      "Rent from leases of three years or less where tax was paid when the appliance was bought. " +
      "Colorado's return counts it in gross sales and takes it off on Schedule A line A13-1 " +
      "\"Other exempt sales\", naming the exemption on the line.",
    confidence: "MEDIUM",
  },
  NOT_TAXED_CATEGORY: {
    label: "A3-1 Sales of nontaxable services",
    reportAs: "DEDUCTION",
    scheduleLine: "A3-1",
    bucketName: "Charges that are not taxable (services and fees)",
    plainWords:
      "Amounts for services and fees Colorado does not tax. The return's own instructions put " +
      "services that are not taxable on Schedule A line A3-1.",
    confidence: "HIGH",
  },
  EXEMPT_CUSTOMER_OTHER: {
    label: "A4-1 Sales to exempt entities and organizations",
    reportAs: "DEDUCTION",
    scheduleLine: "A4-1",
    bucketName: "Sales to exempt customers (government, charities, schools)",
    plainWords:
      "Sales to buyers who are exempt by law, with their exemption certificate on file. " +
      "The return puts them on Schedule A line A4-1. (A buyer purchasing for resale is a " +
      "wholesale sale instead — line A1-1.)",
    confidence: "HIGH",
  },
  OUTSIDE_AREA: {
    label: "A2-1 Sales made to nonresidents or sourced to locations outside of Colorado",
    reportAs: "DEDUCTION",
    scheduleLine: "A2-1",
    bucketName: "Sales delivered outside this return's taxing area",
    plainWords:
      "Sales counted on this return but delivered outside Colorado go on Schedule A line A2-1. " +
      "Sales delivered to another Colorado location are reported on that location's return " +
      "instead and never enter this return's gross sales.",
    confidence: "MEDIUM",
  },
};

/** The packet's deduction buckets in settings display order. */
export const DEDUCTION_BUCKET_KEYS: readonly string[] = Object.keys(RESEARCHED_DEDUCTION_DEFAULTS);

const REPORT_AS: readonly string[] = ["DEDUCTION", "LEAVE_OUT_OF_GROSS"];

/**
 * Tolerant read of a stored deductionLabels value (the same contract the
 * packet has always used: unusable entries are skipped, never invented).
 * A stored entry with no recorded source, or one saved before provenance
 * existed, is the owner's wording.
 */
export function parseDeductionLabels(value: unknown): Record<string, DeductionLabelEntry> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  const result: Record<string, DeductionLabelEntry> = {};
  for (const [key, v] of Object.entries(value)) {
    if (!v || Array.isArray(v) || typeof v !== "object") continue;
    const item = v as { label?: unknown; reportAs?: unknown; source?: unknown };
    if (typeof item.label !== "string" || !item.label.trim()) continue;
    if (typeof item.reportAs !== "string" || !REPORT_AS.includes(item.reportAs)) continue;
    result[key] = {
      label: item.label.trim(),
      reportAs: item.reportAs as DeductionReportAs,
      source: item.source === "RESEARCHED_DEFAULT" || item.source === "ACCOUNTANT"
        ? item.source : "OWNER",
    };
  }
  return result;
}

/** The researched defaults as stored-shape entries, for starting values and restores. */
export function recommendedDeductionLabels(): Record<string, DeductionLabelEntry> {
  const out: Record<string, DeductionLabelEntry> = {};
  for (const [key, def] of Object.entries(RESEARCHED_DEDUCTION_DEFAULTS)) {
    out[key] = { label: def.label, reportAs: def.reportAs, source: "RESEARCHED_DEFAULT" };
  }
  return out;
}

/**
 * Effective labels for a packet or a settings screen: the owner's saved
 * entry wins for its bucket; every researched bucket with no saved entry
 * resolves to its researched default (marked RESEARCHED_DEFAULT so the
 * packet can show the pending provenance). Buckets with neither stay
 * absent — the packet keeps showing those as not decided (S-T9).
 */
export function resolveDeductionLabels(value: unknown): Record<string, DeductionLabelEntry> {
  const resolved = parseDeductionLabels(value);
  for (const [key, entry] of Object.entries(recommendedDeductionLabels())) {
    if (!resolved[key]) resolved[key] = entry;
  }
  return resolved;
}
