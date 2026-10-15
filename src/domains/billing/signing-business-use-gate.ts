import type { Prisma } from "@prisma/client";
import type { FrozenSigningEvidence } from "./signing-frozen-evidence";
import { getEffectiveSetupTaxTreatmentInTx } from "./setup-tax-policy-version";

/** A CPA-backed policy can be revoked after a frozen draft is prepared.
 * Every new binding send or customer signature must re-check the decision.
 * Reading the singleton under a shared lock serializes against owner edits. */
export async function assertCurrentSigningPolicyInTx(
  tx: Prisma.TransactionClient,
  frozen: readonly FrozenSigningEvidence[],
  at = new Date(),
): Promise<void> {
  // The V2 draft may encode accurate synthetic/admin review without a
  // legally approved customer collection contract. The mandatory category
  // professional-review field is REVIEW_REQUIRED until a separately audited
  // owner adviser-approval record and complete refund/return integration exist.
  // Never activate V2 customer signing from an engineering-only hash.
  if (frozen.some(row => row.schemaVersion === 2))
    throw new Error("V2 financial terms require approved adviser evidence and complete refund activation before real signing.");
  if (!frozen.some(row => row.setupFeeCents > 0)) return;
  await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR SHARE`;
  const effective = await getEffectiveSetupTaxTreatmentInTx(tx, at);
  const rows = await tx.agreementSigningCharge.findMany({
    where: { agreementId: { in: frozen.map(row => row.agreementId) } },
    select: { agreementId: true, setupFeeCents: true, setupFeeTaxTreatment: true },
  });
  if (effective === "UNDECIDED" || rows.length !== frozen.length ||
      rows.some(row => row.setupFeeCents > 0 && row.setupFeeTaxTreatment !== effective)) {
    throw new Error("CPA setup-fee policy changed or was revoked. Re-review and freeze the order before this business action.");
  }
}
