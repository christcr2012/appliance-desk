import { createHash } from "node:crypto";
import type { SigningFeeTaxReview } from "./signing-charge-tax-evidence";

export type SigningDraftFact = {
  agreementId: string;
  serviceAddressId: string;
  sourceFingerprint: string;
  version: number;
  firstMonthRentCents: number;
  setupFeeCents: number;
  downPaymentCents: number;
};
export type SigningDraftTaxRow = {
  agreementId: string;
  serviceAddressId: string;
  version: number;
  review: SigningFeeTaxReview;
};
export type SigningOrderLineDraft = {
  agreementId: string;
  serviceAddressId: string;
  version: number;
  setupFeeCents: number;
  downPaymentCents: number;
  setupTaxCents: number;
  allInCandidateCents: number;
  jurisdictionEvidence: Array<{
    jurisdictionId: string;
    rateVersionId: string;
    taxableCents: number;
    exemptCents: number;
    taxCents: number;
  }>;
};
export type SigningOrderDraftContract = {
  status: "BLOCKED" | "OWNER_DRAFT_ONLY";
  reasons: string[];
  sourceFingerprint: string | null;
  draftFingerprint: string | null;
  lines: SigningOrderLineDraft[];
  totals: { setupFeeCents: number; downPaymentCents: number;
    setupTaxCents: number; allInCandidateCents: number } | null;
  /** No draft contract is permission to send a customer agreement or collect. */
  eligibleForSigning: false;
  eligibleForCollection: false;
};

const cents = (value: number) => Number.isSafeInteger(value) && value >= 0;
function blocked(reasons: string[]): SigningOrderDraftContract {
  return { status: "BLOCKED", reasons: [...new Set(reasons)], sourceFingerprint: null,
    draftFingerprint: null, lines: [], totals: null,
    eligibleForSigning: false, eligibleForCollection: false };
}

/**
 * Private, deterministic all-in DRAFT construction. Financial inputs must be
 * loaded from trusted stored records, not browser fields. This function does
 * not persist anything, release a quote, freeze a signed price or charge.
 */
export function assembleSigningOrderDraft(input: {
  agreements: readonly SigningDraftFact[];
  taxRows: readonly SigningDraftTaxRow[];
}): SigningOrderDraftContract {
  const { agreements, taxRows } = input;
  const errors: string[] = [];
  const ids = new Set(agreements.map((row) => row.agreementId));
  if (!agreements.length || agreements.length > 500 || ids.size !== agreements.length ||
      taxRows.length !== agreements.length ||
      new Set(taxRows.map((row) => row.agreementId)).size !== taxRows.length ||
      taxRows.some((row) => !ids.has(row.agreementId))) {
    return blocked(["A complete and unique agreement-to-tax-review set is required."]);
  }
  const fingerprints = new Set(agreements.map((row) => row.sourceFingerprint));
  if (fingerprints.size !== 1 || !/^[0-9a-f]{64}$/.test(agreements[0].sourceFingerprint)) {
    return blocked(["The order source versions are inconsistent or invalid."]);
  }
  const reviewById = new Map(taxRows.map((row) => [row.agreementId, row]));
  const feeLocations = new Set<string>();
  const lines: SigningOrderLineDraft[] = [];
  let setup = 0, down = 0, tax = 0, allIn = 0;
  for (const row of [...agreements].sort((a, b) => a.agreementId.localeCompare(b.agreementId))) {
    const taxRow = reviewById.get(row.agreementId);
    const review = taxRow?.review;
    if (!row.agreementId || !row.serviceAddressId || !Number.isSafeInteger(row.version) ||
        row.version < 1 || ![row.firstMonthRentCents, row.setupFeeCents, row.downPaymentCents]
          .every(cents) ||
        (row.downPaymentCents !== 0 && row.downPaymentCents !== row.firstMonthRentCents)) {
      errors.push(`Invalid prepared amounts for ${row.agreementId}.`);
      continue;
    }
    if (row.setupFeeCents > 0) {
      if (feeLocations.has(row.serviceAddressId)) errors.push("A delivery location received duplicate setup fees.");
      feeLocations.add(row.serviceAddressId);
    }
    if (!taxRow || taxRow.serviceAddressId !== row.serviceAddressId ||
        taxRow.version !== row.version || !review || review.status !== "CALCULATED_DRAFT" ||
        review.eligibleForCollection !== false || review.reasons.length !== 0 ||
        review.setupTaxCents === null || review.candidateSigningTotalCents === null ||
        !cents(review.setupTaxCents) || !cents(review.candidateSigningTotalCents)) {
      errors.push(`Missing or invalid category-confirmed tax candidate for ${row.agreementId}.`);
      continue;
    }
    const evidence = review.jurisdictionLines.map((entry) => ({
      jurisdictionId: entry.jurisdictionId, rateVersionId: entry.rateVersionId,
      taxableCents: entry.taxableCents, exemptCents: entry.exemptCents,
      taxCents: entry.taxCents,
    }));
    if (row.setupFeeCents > 0 && evidence.length === 0) {
      errors.push(`Missing jurisdiction evidence for ${row.agreementId}.`);
    }
    const evidenceKeys = new Set<string>();
    for (const item of review.jurisdictionLines) {
      const key = `${item.jurisdictionId}:${item.rateVersionId}`;
      if (!item.jurisdictionId || evidenceKeys.has(key) ||
          item.category !== "ADMINISTRATIVE_SETUP" || item.lineKey !== "administrative-setup" ||
          ![item.taxCents, item.taxableCents, item.exemptCents].every(cents) ||
          item.taxableCents + item.exemptCents !== row.setupFeeCents) {
        errors.push(`Invalid jurisdiction tax evidence for ${row.agreementId}.`);
      }
      evidenceKeys.add(key);
    }
    const perTax = evidence.reduce((sum, entry) => sum + entry.taxCents, 0);
    const candidate = row.setupFeeCents + row.downPaymentCents + perTax;
    if (![perTax, candidate].every(cents) ||
        perTax !== review.setupTaxCents || candidate !== review.candidateSigningTotalCents) {
      errors.push(`Tax evidence does not reconcile with the draft total for ${row.agreementId}.`);
    }
    evidence.sort((a, b) => a.jurisdictionId.localeCompare(b.jurisdictionId) ||
      a.rateVersionId.localeCompare(b.rateVersionId));
    lines.push({ agreementId: row.agreementId, serviceAddressId: row.serviceAddressId,
      version: row.version, setupFeeCents: row.setupFeeCents,
      downPaymentCents: row.downPaymentCents, setupTaxCents: perTax,
      allInCandidateCents: candidate, jurisdictionEvidence: evidence });
    setup += row.setupFeeCents;
    down += row.downPaymentCents;
    tax += perTax;
    allIn += candidate;
  }
  if (![setup, down, tax, allIn].every(cents) ||
      allIn !== setup + down + tax || lines.length !== agreements.length) {
    errors.push("Order-wide amounts failed cent-for-cent reconciliation.");
  }
  if (errors.length) return blocked(errors);
  const serialized = JSON.stringify({ sourceFingerprint: agreements[0].sourceFingerprint, lines });
  return { status: "OWNER_DRAFT_ONLY", reasons: [], sourceFingerprint: agreements[0].sourceFingerprint,
    draftFingerprint: createHash("sha256").update(serialized).digest("hex"),
    lines, totals: { setupFeeCents: setup, downPaymentCents: down,
      setupTaxCents: tax, allInCandidateCents: allIn },
    eligibleForSigning: false, eligibleForCollection: false };
}
