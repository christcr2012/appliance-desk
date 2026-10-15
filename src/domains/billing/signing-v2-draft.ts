import { createHash } from "node:crypto";
import type { SigningOrderDraftContract } from "./signing-order-draft-contract";
import { buildSigningV2Extension } from "./signing-v2-lines";

export function assembleSigningV2Draft(input: {
  draft: SigningOrderDraftContract;
  sources: readonly {
    agreementId: string; serviceAddressId: string; estimateId: string;
    depositCents: number; mandatoryHistory: unknown; reserveHistory: unknown;
  }[];
  policyRevision: number; settingsUpdatedAt: string;
}): SigningOrderDraftContract {
  const { draft } = input;
  if (draft.status !== "OWNER_DRAFT_ONLY" || !draft.totals ||
      draft.reasons.length || !draft.sourceFingerprint || !draft.draftFingerprint ||
      !draft.lines.length || draft.lines.length !== input.sources.length)
    throw new Error("A complete reviewed setup and tax order is required.");
  const byId = new Map(input.sources.map(row => [row.agreementId, row]));
  if (byId.size !== input.sources.length ||
      draft.lines.some(row => !byId.has(row.agreementId)))
    throw new Error("V2 charge sources must cover the customer order.");
  const lines = draft.lines.map(row => {
    const source = byId.get(row.agreementId)!;
    if (source.serviceAddressId !== row.serviceAddressId || !source.estimateId)
      throw new Error("Mandatory charge review came from a foreign address.");
    const { extension, allInCents } = buildSigningV2Extension({
      agreementId: row.agreementId, serviceAddressId: row.serviceAddressId,
      estimateId: source.estimateId,
      setupFeeCents: row.setupFeeCents, downPaymentCents: row.downPaymentCents,
      setupTaxCents: row.setupTaxCents, setupJurisdictions: row.jurisdictionEvidence,
      depositCents: source.depositCents, mandatoryHistory: source.mandatoryHistory,
      reserveHistory: source.reserveHistory, policyRevision: input.policyRevision,
      settingsUpdatedAt: input.settingsUpdatedAt,
    });
    return { ...row, allInCandidateCents: allInCents, v2Extension: extension };
  }).sort((a, b) => a.agreementId.localeCompare(b.agreementId));
  let total = 0;
  for (const row of lines) {
    total += row.allInCandidateCents;
    if (!Number.isSafeInteger(total) || total < 0)
      throw new Error("V2 signing total exceeds integer cents.");
  }
  const draftFingerprint = createHash("sha256").update(JSON.stringify({
    sourceFingerprint: draft.sourceFingerprint, lines,
  })).digest("hex");
  return { ...draft, evidenceVersion: 2, lines, draftFingerprint,
    totals: { ...draft.totals, allInCandidateCents: total } };
}
