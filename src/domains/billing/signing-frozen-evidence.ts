import type { SigningOrderDraftContract } from "./signing-order-draft-contract";

export type FrozenSigningEvidence = {
  schemaVersion: 1;
  agreementId: string;
  serviceAddressId: string;
  agreementVersion: number;
  sourceFingerprint: string;
  orderFingerprint: string;
  setupFeeCents: number;
  downPaymentCents: number;
  setupTaxCents: number;
  allInCents: number;
  jurisdictions: SigningOrderDraftContract["lines"][number]["jurisdictionEvidence"];
};

const cents = (n: number) => Number.isSafeInteger(n) && n >= 0;
function safeAdd(a: number, b: number) {
  const result = a + b;
  if (!cents(result)) throw new Error("Invalid frozen signing arithmetic.");
  return result;
}

/** Server-side only; never grants customer collection/signing permission. */
export function buildFrozenSigningEvidence(draft: SigningOrderDraftContract): FrozenSigningEvidence[] {
  if (draft.status !== "OWNER_DRAFT_ONLY" || draft.reasons.length ||
      !draft.sourceFingerprint || !/^[a-f0-9]{64}$/.test(draft.sourceFingerprint) ||
      !draft.draftFingerprint || !/^[a-f0-9]{64}$/.test(draft.draftFingerprint) ||
      !draft.totals || !draft.lines.length) {
    throw new Error("Reviewed all-in tax evidence is required.");
  }
  const seen = new Set<string>();
  const evidence = draft.lines.map(line => {
    if (!line.agreementId || !line.serviceAddressId || seen.has(line.agreementId) ||
        !Number.isSafeInteger(line.version) || line.version < 1 ||
        ![line.setupFeeCents, line.downPaymentCents, line.setupTaxCents, line.allInCandidateCents].every(cents) ||
        safeAdd(safeAdd(line.setupFeeCents, line.downPaymentCents), line.setupTaxCents) !== line.allInCandidateCents)
      throw new Error("Invalid agreement signing evidence.");
    seen.add(line.agreementId);
    if (line.jurisdictionEvidence.some(row => !row.jurisdictionId || !row.rateVersionId ||
        ![row.taxableCents, row.exemptCents, row.taxCents].every(cents)) ||
        line.jurisdictionEvidence.reduce((v, row) => safeAdd(v, row.taxCents), 0) !== line.setupTaxCents)
      throw new Error("Jurisdiction tax evidence does not reconcile.");
    return {
      schemaVersion: 1 as const, agreementId: line.agreementId,
      serviceAddressId: line.serviceAddressId, agreementVersion: line.version,
      sourceFingerprint: draft.sourceFingerprint!,
      orderFingerprint: draft.draftFingerprint!,
      setupFeeCents: line.setupFeeCents, downPaymentCents: line.downPaymentCents,
      setupTaxCents: line.setupTaxCents, allInCents: line.allInCandidateCents,
      jurisdictions: line.jurisdictionEvidence.map(row => ({ ...row })),
    };
  });
  const total = evidence.reduce((sum, row) => ({
    setupFeeCents: safeAdd(sum.setupFeeCents, row.setupFeeCents),
    downPaymentCents: safeAdd(sum.downPaymentCents, row.downPaymentCents),
    setupTaxCents: safeAdd(sum.setupTaxCents, row.setupTaxCents),
    allInCandidateCents: safeAdd(sum.allInCandidateCents, row.allInCents),
  }), { setupFeeCents: 0, downPaymentCents: 0, setupTaxCents: 0, allInCandidateCents: 0 });
  if (total.setupFeeCents !== draft.totals.setupFeeCents ||
      total.downPaymentCents !== draft.totals.downPaymentCents ||
      total.setupTaxCents !== draft.totals.setupTaxCents ||
      total.allInCandidateCents !== draft.totals.allInCandidateCents)
    throw new Error("The signing order totals do not reconcile.");
  return evidence;
}
