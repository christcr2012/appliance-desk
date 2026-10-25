// M-2C: income-tax estimate for selling a retired rental appliance.
// Pure rules, no database (the new-sale screen and the saved sale both use them).
//
// Source: docs/designs/RETIRED-APPLIANCE-RESALE-TAX-2026-10-08.md (sections 1-2). Nothing here ever limits a price. It only
// tells the owner what an accountant will want to look at. Book depreciation is never used as tax depreciation: the
// numbers come only from tax evidence somebody typed in (and ideally the CPA confirmed). Missing or unclear evidence
// gives no number at all, only "CPA review needed".

export type TaxConfidence = "UNKNOWN" | "OWNER_SUPPLIED" | "CPA_CONFIRMED";

/** What the accountant (or the owner) recorded about one appliance's tax history. All money is whole cents. */
export type TaxEvidence = {
  classification: string; // RENTAL_ASSET | EXPENSED | INVENTORY | OTHER | UNKNOWN
  confidence: TaxConfidence | string;
  originalBasisCents: number | null;
  signedAdjustmentsCents: number | null;
  allowedDepreciationCents: number | null;
  section179Cents: number | null;
  bonusDepreciationCents: number | null;
};

export type ResaleTaxStatus =
  /** Numbers from evidence the CPA confirmed. Still an estimate, never a filing. */
  | "CPA_CONFIRMED_ESTIMATE"
  /** Numbers from evidence the owner typed in and nobody confirmed. */
  | "UNCONFIRMED_ESTIMATE"
  /** Evidence is missing or unclear: no tax numbers at all. */
  | "CPA_REVIEW_NEEDED";

export type ResaleTaxEstimate = {
  status: ResaleTaxStatus;
  /** price minus the owner's costs of selling it (before the buyer's sales tax, which is never income). */
  netProceedsCents: number;
  /** Plain-English reasons the accountant must look (empty when the CPA confirmed everything). */
  reasons: string[];
  adjustedBasisCents: number | null;
  totalDepreciationCents: number | null;
  /** Positive = gain, negative = loss. */
  taxGainCents: number | null;
  /** The part of a gain that may be taxed as ordinary income because of depreciation already taken. */
  potentialRecaptureCents: number | null;
  /** Gain above that, which the accountant classifies. */
  otherGainCents: number | null;
};

export const RECAPTURE_WARNING =
  "Selling above depreciated tax basis may trigger ordinary-income depreciation recapture. You can still sell at your chosen price.";

const REASON = {
  none: "No tax evidence has been recorded for this appliance, so your accountant needs to work out its tax basis and depreciation.",
  unknown: "The tax evidence for this appliance is marked unknown.",
  notRental: "This appliance was recorded as expensed, resale stock or another kind of asset. Your accountant decides how the sale is reported.",
  basis: "The original tax basis was not recorded.",
  depreciation: "The depreciation taken (or allowable) was not recorded.",
  negative: "The recorded depreciation is more than the recorded basis. Your accountant needs to check the numbers.",
  owner: "These numbers were typed in by you and have not been confirmed by your accountant.",
} as const;

const isCents = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);

export function estimateRetiredSale(input: {
  priceCents: number;
  sellerCostsCents?: number;
  evidence: TaxEvidence | null;
}): ResaleTaxEstimate {
  const sellerCosts = input.sellerCostsCents ?? 0;
  const net = input.priceCents - sellerCosts;
  const none = (reasons: string[]): ResaleTaxEstimate => ({
    status: "CPA_REVIEW_NEEDED", netProceedsCents: net, reasons,
    adjustedBasisCents: null, totalDepreciationCents: null, taxGainCents: null, potentialRecaptureCents: null, otherGainCents: null,
  });

  const e = input.evidence;
  if (!e) return none([REASON.none]);
  if (e.confidence === "UNKNOWN" || e.classification === "UNKNOWN") return none([REASON.unknown]);
  // Expensed or resale stock: never invent a depreciation record for it.
  if (e.classification !== "RENTAL_ASSET") return none([REASON.notRental]);

  const reasons: string[] = [];
  if (!isCents(e.originalBasisCents)) reasons.push(REASON.basis);
  if (!isCents(e.allowedDepreciationCents)) reasons.push(REASON.depreciation);
  if (reasons.length > 0) return none(reasons);

  const totalDepreciation = e.allowedDepreciationCents! + (e.section179Cents ?? 0) + (e.bonusDepreciationCents ?? 0);
  const adjustedBasis = e.originalBasisCents! + (e.signedAdjustmentsCents ?? 0) - totalDepreciation;
  if (adjustedBasis < 0 || totalDepreciation < 0) return none([REASON.negative]);

  const gain = net - adjustedBasis;
  const recapture = gain > 0 ? Math.min(gain, totalDepreciation) : 0;
  const confirmed = e.confidence === "CPA_CONFIRMED";
  return {
    status: confirmed ? "CPA_CONFIRMED_ESTIMATE" : "UNCONFIRMED_ESTIMATE",
    netProceedsCents: net,
    reasons: confirmed ? [] : [REASON.owner],
    adjustedBasisCents: adjustedBasis,
    totalDepreciationCents: totalDepreciation,
    taxGainCents: gain,
    potentialRecaptureCents: recapture,
    otherGainCents: gain > 0 ? gain - recapture : 0,
  };
}

/** True when the owner still has a follow-up with the accountant for this sale. */
export const needsCpaFollowUp = (status: ResaleTaxStatus | string): boolean => status !== "CPA_CONFIRMED_ESTIMATE";

export const RESALE_STATUS_LABEL: Record<ResaleTaxStatus, string> = {
  CPA_CONFIRMED_ESTIMATE: "Estimate from accountant-confirmed numbers",
  UNCONFIRMED_ESTIMATE: "Estimate from numbers nobody has confirmed — CPA review needed",
  CPA_REVIEW_NEEDED: "CPA review needed — no tax estimate",
};
