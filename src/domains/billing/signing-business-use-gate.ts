import { getAgreementTaxContext } from "@/domains/tax/locations";
import { computeTax } from "@/domains/tax/engine";
import { readMandatoryChargeHistory } from "./mandatory-charge-review";
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
    const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{signingMandatoryPolicyVersions:true,updatedAt:true}});
    const reserveIds=frozen.filter(row=>row.schemaVersion===2&&row.v2Extension.components.some(c=>c.category==="COMMERCIAL_RESERVE"&&c.amountCents>0)).map(row=>row.agreementId);
    if(reserveIds.length){
      const customers=await tx.rentalAgreement.findMany({where:{id:{in:reserveIds}},select:{customer:{select:{isBusiness:true,isPropertyManager:true}}}});
      if(customers.length!==reserveIds.length||customers.some(row=>!row.customer.isBusiness&&!row.customer.isPropertyManager))
        throw new Error("Refundable commercial reserves require a reviewed business or property-manager account, never a household deposit.");
    }
    const sources=await tx.rentalAgreement.findMany({where:{id:{in:frozen.filter(row=>row.schemaVersion===2).map(row=>row.agreementId)}},
      select:{id:true,mandatoryChargeReviewVersions:true}});
    const kinds={ADMINISTRATIVE_SETUP:"ADMIN_SETUP_FEE",DELIVERY:"DELIVERY_FEE",INSTALLATION:"INSTALLATION_FEE",REMOVAL:"REMOVAL_FEE",DAMAGE_WAIVER:"DAMAGE_WAIVER"} as const;
    for(const line of frozen){
      if(line.schemaVersion!==2)continue;
      const source=sources.find(row=>row.id===line.agreementId);
      const history=readMandatoryChargeHistory(source?.mandatoryChargeReviewVersions);
      const review=history.find(row=>row.revision===line.v2Extension.mandatoryReviewRevision);
      if(!settings || review?.settingsUpdatedAt!==settings.updatedAt.toISOString())
        throw new Error("Fee or agreement settings changed after this frozen review. Reprepare the unsigned order.");
      const components=line.v2Extension.components.filter(row=>row.category in kinds&&row.disposition==="DUE_NOW"&&row.amountCents>0);
      if(!components.length)continue;
      const context=await getAgreementTaxContext(tx,line.agreementId,at);
      const current=computeTax({...context,lines:components.map(row=>({key:row.id,kind:kinds[row.category as keyof typeof kinds],amountCents:row.amountCents}))});
      const canonical=(rows:Array<{componentId:string;jurisdictionId:string;rateVersionId:string;category:string;taxableCents:number;exemptCents:number;taxCents:number}>)=>
        rows.map(row=>JSON.stringify([row.componentId,row.jurisdictionId,row.rateVersionId,row.category,row.taxableCents,row.exemptCents,row.taxCents])).sort().join(";");
      if(!current.ok || canonical(current.lines.map(row=>({...row,componentId:row.lineKey})))!==canonical(line.v2Extension.taxLines))
        throw new Error("Tax evidence changed after the frozen review. Reprepare the unsigned order before binding it.");
    }
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
