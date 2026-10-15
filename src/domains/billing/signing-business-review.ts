import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";
import { getFrozenSigningOrderInTx } from "./signing-frozen-verify";
import type { FrozenSigningEvidence } from "./signing-frozen-evidence";

export type SigningBusinessReviewInput = {
  agreementId: string; expectedOrderFingerprint: string;
  decision: "APPROVED" | "REVIEW_REQUIRED";
  effectiveFromKey: string; confirmedOnKey: string;
  taxAdviserReference: string; legalAdviserReference: string;
  termsReference: string; reason: string; acknowledged: boolean;
};
function text(value: unknown, min: number, max = 500): value is string {
  return typeof value === "string" && value.trim().length >= min && value.length <= max;
}
function dateKey(value: string): boolean {
  const day = new Date(value + "T12:00:00Z");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(day.getTime()) &&
    day.toISOString().slice(0,10) === value;
}
export function validateSigningBusinessReview(input: SigningBusinessReviewInput, at: Date) {
  if (!text(input.agreementId, 1, 256) || !/^[a-f0-9]{64}$/.test(input.expectedOrderFingerprint) ||
      !["APPROVED", "REVIEW_REQUIRED"].includes(input.decision) ||
      !dateKey(input.effectiveFromKey) || !dateKey(input.confirmedOnKey) ||
      input.confirmedOnKey > businessDateKey(at) || !text(input.reason, 12) ||
      !text(input.taxAdviserReference, 12) || !text(input.legalAdviserReference, 12) ||
      !text(input.termsReference, 12) || input.acknowledged !== true)
    throw new Error("Record dated CPA and counsel advice, exact terms, a reason and your acknowledgement. Future confirmations are not evidence.");
  return { ...input, reason: input.reason.trim(),
    taxAdviserReference: input.taxAdviserReference.trim(),
    legalAdviserReference: input.legalAdviserReference.trim(), termsReference: input.termsReference.trim() };
}

/** Owner attestation records received advice; no agent or engineering test supplies it.
 * The approval binds exactly one frozen order; revocation is a new immutable revision. */
export async function recordSigningBusinessReview(actorUserId: string, input: SigningBusinessReviewInput) {
  const at = new Date();
  const value = validateSigningBusinessReview(input, at);
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const target = await tx.rentalAgreement.findUniqueOrThrow({ where: { id: value.agreementId },
      select: { id:true, customerId:true, sourceEstimateId:true } });
    const scope = await tx.rentalAgreement.findMany({
      where: { customerId:target.customerId, ...(target.sourceEstimateId
        ? {sourceEstimateId:target.sourceEstimateId} : {id:target.id}) },
      orderBy:{id:"asc"},select:{id:true},
    });
    if (!scope.length || scope.length > 500) throw new Error("Review requires a bounded complete order.");
    await tx.$queryRaw`SELECT "id" FROM "RentalAgreement" WHERE "id" IN (${Prisma.join(scope.map(row=>row.id))}) ORDER BY "id" FOR UPDATE`;
    const frozen = await getFrozenSigningOrderInTx(tx, value.agreementId);
    if (frozen.length !== scope.length || frozen.some(row=>row.schemaVersion!==2 ||
        row.orderFingerprint!==value.expectedOrderFingerprint || !scope.some(a=>a.id===row.agreementId)))
      throw new Error("Frozen order changed. Review every location again before confirming advice.");
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"w22-review:" + value.expectedOrderFingerprint}, 0))::text`;
    for (const row of frozen) {
      const previous = await tx.signingBusinessReview.findFirst({ where:{agreementId:row.agreementId},
        orderBy:{revision:"desc"}, select:{revision:true} });
      await tx.signingBusinessReview.create({ data:{
        agreementId:row.agreementId,revision:(previous?.revision ?? 0)+1,
        orderFingerprint:row.orderFingerprint,decision:value.decision,
        effectiveFromKey:value.effectiveFromKey,confirmedOnKey:value.confirmedOnKey,
        taxAdviserReference:value.taxAdviserReference,legalAdviserReference:value.legalAdviserReference,
        termsReference:value.termsReference,reason:value.reason,actorUserId,recordedAt:at,
      } });
    }
    await tx.auditLog.create({data:{ userId:actorUserId,action:"signing.business_review",
      entityType:"RentalAgreement",entityId:target.id,newValue:{
        decision:value.decision,orderFingerprint:value.expectedOrderFingerprint,
        agreementCount:frozen.length,effectiveFromKey:value.effectiveFromKey,
        confirmedOnKey:value.confirmedOnKey,
      } }});
    return {decision:value.decision,agreements:frozen.length};
  }, { isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20_000 });
}

export async function assertSigningBusinessReviewsInTx(
  tx:Prisma.TransactionClient, frozen:readonly FrozenSigningEvidence[], at=new Date(),
) {
  const v2 = frozen.filter(row=>row.schemaVersion===2);
  if (!v2.length) return;
  // Protect even the absent-row case: a row share lock cannot serialize
  // a new revocation INSERT. Owner revisions and money/signing reads share
  // this order-scoped transaction lock after their existing lifecycle locks.
  for(const fingerprint of [...new Set(v2.map(row=>row.orderFingerprint))].sort())
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"w22-review:" + fingerprint}, 0))::text`;
  const key=businessDateKey(at);
  for(const row of v2){
    const review=await tx.signingBusinessReview.findFirst({where:{agreementId:row.agreementId,
      effectiveFromKey:{lte:key},recordedAt:{lte:at}},orderBy:{revision:"desc"}});
    if(!review || review.decision!=="APPROVED" || review.orderFingerprint!==row.orderFingerprint ||
       review.confirmedOnKey>key || !text(review.taxAdviserReference,12) ||
       !text(review.legalAdviserReference,12) || !text(review.termsReference,12))
      throw new Error("This frozen order requires current owner-recorded CPA and counsel advice. Review Signing business clearance on the agreement.");
  }
}
