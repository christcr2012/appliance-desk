import { verifySigningV2Extension, type SigningV2Extension } from "./signing-v2-lines";
import type { SigningOrderDraftContract } from "./signing-order-draft-contract";

export type FrozenSigningEvidenceV1 = {
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

export type FrozenSigningEvidenceV2 = Omit<FrozenSigningEvidenceV1, "schemaVersion"> & {
  schemaVersion: 2;
  v2Extension: SigningV2Extension;
};
export type FrozenSigningEvidence = FrozenSigningEvidenceV1 | FrozenSigningEvidenceV2;

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
        (draft.evidenceVersion !== 2 &&
          safeAdd(safeAdd(line.setupFeeCents, line.downPaymentCents), line.setupTaxCents) !== line.allInCandidateCents))
      throw new Error("Invalid agreement signing evidence.");
    seen.add(line.agreementId);
    if (line.jurisdictionEvidence.some(row => !row.jurisdictionId || !row.rateVersionId ||
        ![row.taxableCents, row.exemptCents, row.taxCents].every(cents)) ||
        line.jurisdictionEvidence.reduce((v, row) => safeAdd(v, row.taxCents), 0) !== line.setupTaxCents)
      throw new Error("Jurisdiction tax evidence does not reconcile.");
    const common = {
      agreementId: line.agreementId, serviceAddressId: line.serviceAddressId,
      agreementVersion: line.version, sourceFingerprint: draft.sourceFingerprint!,
      orderFingerprint: draft.draftFingerprint!,
      setupFeeCents: line.setupFeeCents, downPaymentCents: line.downPaymentCents,
      setupTaxCents: line.setupTaxCents, allInCents: line.allInCandidateCents,
      jurisdictions: line.jurisdictionEvidence.map(row => ({ ...row })),
    };
    if (draft.evidenceVersion === 2) {
      if (!line.v2Extension)
        throw new Error("An all-in V2 component source is missing.");
      const verified = verifySigningV2Extension(line.v2Extension, {
        agreementId: line.agreementId, setupFeeCents: line.setupFeeCents,
        downPaymentCents: line.downPaymentCents, setupTaxCents: line.setupTaxCents,
        allInCents: line.allInCandidateCents,
      });
      return { ...common, schemaVersion: 2 as const, v2Extension: verified };
    }
    if (line.v2Extension)
      throw new Error("A V2 component cannot be silently cast into V1 frozen money.");
    return { ...common, schemaVersion: 1 as const };
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
