import { effectiveMandatorySigningPolicy } from "./signing-mandatory-policy";
import { assertSigningBusinessReviewsInTx } from "./signing-business-review";
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
  await assertSigningBusinessReviewsInTx(tx, frozen, at);
  if(frozen.some(row=>row.schemaVersion===2)){
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = ${"singleton"} FOR SHARE`;
    const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{signingMandatoryPolicyVersions:true}});
    const effective=effectiveMandatorySigningPolicy(settings?.signingMandatoryPolicyVersions,at);
    if(frozen.some(row=>row.schemaVersion===2 && row.v2Extension.ownerPolicyRevision!==effective.revision))
      throw new Error("Mandatory policy changed. Reprepare and review this unsigned order.");
  }
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
