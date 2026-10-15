import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { requireRole } from "@/lib/session";
import { lockPreparedEstimatePolicyScopeInTx } from "./prepared-policy-scope";
import {
  nextCommercialReserveRevision, readCommercialReserveHistory,
  validateCommercialReserveProposal,
  type ProposedReserveAllocation,
} from "./commercial-reserve-policy";

/**
 * Commercial reserve terms are prepared against one OWNER-only estimate and
 * all of its actual customer-owned draft addresses. This does NOT charge,
 * create a deposit ledger record, issue an invoice or approve legal wording.
 */
export type PreparedReserveAllocation = {
  agreementId: string;
  serviceAddressId: string;
  addressLabel: string;
  amountCents: number;
  revision: number | null;
  replenishment: "QUARTERLY" | "NONE";
  termsReference: string;
  recordedByUserId: string | null;
  status: "REVIEW_REQUIRED" | "NOT_RECORDED";
};
export type PreparedReserveOverview = {
  estimateId: string;
  customerId: string;
  estimateUpdatedAt: string;
  expectedReserveCents: number;
  allocatedReserveCents: number;
  canAllocate: boolean;
  businessEligible: boolean;
  allocations: PreparedReserveAllocation[];
  reasons: string[];
};
function sumCents(values: number[]): number {
  if (values.some(n=>!Number.isSafeInteger(n)||n<0||n>100_000_000))
    throw new Error("Refundable reserve amount must be valid integer cents.");
  const total=values.reduce((a,b)=>a+b,0);
  if (!Number.isSafeInteger(total)||total>100_000_000)
    throw new Error("Total negotiated reserve exceeds the supported amount.");
  return total;
}
function machineCountFromLines(lines: readonly {
  quantity:number;
  package: {components:{quantity:number}[]} | null;
}[]): number {
  let machines=0;
  for(const line of lines){
    if(!Number.isSafeInteger(line.quantity)||line.quantity<1||line.quantity>1000||
       !line.package || !line.package.components.length ||
       line.package.components.some(row=>!Number.isSafeInteger(row.quantity)||row.quantity<1)){
      throw new Error("Verify each package and machine quantity before negotiating a reserve.");
    }
    machines+=line.quantity*line.package.components.reduce((sum,row)=>sum+row.quantity,0);
  }
  if(!Number.isSafeInteger(machines)||machines<1||machines>500_000)
    throw new Error("Commercial reserve machine count needs review.");
  return machines;
}
function commercialEligible(customer: {isBusiness:boolean;isPropertyManager:boolean},
    machines:number, threshold:number):boolean {
  if(!Number.isSafeInteger(threshold)||threshold<1||threshold>1000)
    throw new Error("Large-order machine threshold needs owner review.");
  return customer.isBusiness||customer.isPropertyManager||machines>=threshold;
}

/** Private owner/admin read, with no amount offered to any customer. */
export async function getPreparedReserveOverview(estimateId:string):Promise<PreparedReserveOverview|null>{
  await requireRole("OWNER","ADMIN");
  return prisma.$transaction(async tx=>{
    const estimate=await tx.estimate.findUnique({
      where:{id:estimateId},select:{
        id:true,customerId:true,status:true,depositCents:true,depositPaidAt:true,updatedAt:true,
        customer:{select:{isBusiness:true,isPropertyManager:true}},
        lineItems:{select:{quantity:true,package:{select:{
          components:{select:{quantity:true}}}}}},
      },
    });
    if(!estimate?.customerId||!estimate.customer) return null;
    const [settings,agreements]=await Promise.all([
      tx.businessSettings.findUnique({where:{id:"singleton"},select:{largeOrderMachineThreshold:true}}),
      tx.rentalAgreement.findMany({where:{sourceEstimateId:estimateId,
        customerId:estimate.customerId},
        select:{id:true,customerId:true,sourceEstimateId:true,
          serviceAddressId:true,depositCents:true,status:true,
          commercialReservePolicyVersions:true,
          serviceAddress:{select:{line1:true,city:true,state:true,zip:true}} },
        orderBy:{id:"asc"}}),
    ]);
    if(!agreements.length) return null;
    const reasons:string[]=[];
    let businessEligible=false;
    try{
      if(!settings) throw new Error("Business settings are unavailable.");
      const machineCount=machineCountFromLines(estimate.lineItems);
      businessEligible=commercialEligible(estimate.customer,machineCount,settings.largeOrderMachineThreshold);
    }catch(error){reasons.push(error instanceof Error?error.message:"Machine count review needed.");}
    const allocations:PreparedReserveAllocation[]=agreements.map(a=>{
      const history=readCommercialReserveHistory(a.commercialReservePolicyVersions);
      const last=history.at(-1);
      if(last&&last.amountCents!==a.depositCents)
        reasons.push("Reserve policy history and the actual agreement amount disagree.");
      if(a.status!=="DRAFT")reasons.push("Every prepared agreement must still be a draft.");
      if(!last)reasons.push("The owner has not recorded a reserve decision for "+a.serviceAddress.line1+".");
      return {agreementId:a.id,serviceAddressId:a.serviceAddressId,
        addressLabel:[a.serviceAddress.line1,a.serviceAddress.city,a.serviceAddress.state,
          a.serviceAddress.zip].join(", "),
        amountCents:a.depositCents,revision:last?.revision??null,
        replenishment:last?.replenishment??"NONE",
        termsReference:last?.termsReference??"",
        recordedByUserId:last?.approvedByUserId??null,
        status:last?"REVIEW_REQUIRED":"NOT_RECORDED"};
    });
    const allocatedReserveCents=sumCents(allocations.map(row=>row.amountCents));
    if(allocatedReserveCents!==estimate.depositCents)
      reasons.push("Allocate the estimate's requested reserve exactly once across its properties.");
    if(!businessEligible&&estimate.depositCents>0)
      reasons.push("No refundable reserve is permitted for an ordinary household.");
    if(estimate.depositPaidAt)
      reasons.push("Existing estimate deposit money requires independent finance reconciliation.");
    return {estimateId,customerId:estimate.customerId,
      estimateUpdatedAt:estimate.updatedAt.toISOString(),
      expectedReserveCents:estimate.depositCents,allocatedReserveCents,
      canAllocate:["DRAFT","CHANGES_REQUESTED"].includes(estimate.status)&&!estimate.depositPaidAt,
      businessEligible,allocations,reasons:[...new Set(reasons)]};
  });
}

/**
 * Lock order: OWNER User (via assertActiveTeamActor) → Estimate row →
 * ordered RentalAgreement rows → charge/deposit/receipt checks → writes.
 * Any stale prepared charges are invalidated across ALL locations; no
 * signature, provider, invoice, audit or settled money is altered.
 */
export async function savePreparedCommercialReserveAllocation(input:{
  actorUserId:string;estimateId:string;expectedEstimateUpdatedAt:Date;
  expectedRevisions:ReadonlyArray<{agreementId:string;revision:number|null}>;
  allocations:readonly ProposedReserveAllocation[];
  reason:string;
}){
  if(!input.estimateId || !(input.expectedEstimateUpdatedAt instanceof Date) ||
      !Number.isFinite(input.expectedEstimateUpdatedAt.getTime()) ||
      input.reason.trim().length<12 || input.reason.length>500)
    throw new Error("Refresh and record why this reserve allocation is changing.");
  if(!Array.isArray(input.allocations)||!input.allocations.length||input.allocations.length>500)
    throw new Error("Every prepared delivery location needs an owner reserve decision.");
  const proposals=input.allocations.map(validateCommercialReserveProposal);
  const ids=proposals.map(row=>row.agreementId);
  if(new Set(ids).size!==ids.length)
    throw new Error("A prepared agreement received duplicate reserve allocations.");
  if(input.expectedRevisions.length!==ids.length ||
      new Set(input.expectedRevisions.map(row=>row.agreementId)).size!==ids.length ||
      input.expectedRevisions.some(row=>!ids.includes(row.agreementId) ||
        (row.revision!==null&&(!Number.isSafeInteger(row.revision)||row.revision<1))))
    throw new Error("Reserve history changed. Refresh before editing.");
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,input.actorUserId,["OWNER"]);
    const scope=await lockPreparedEstimatePolicyScopeInTx(
      tx,input.estimateId,input.expectedEstimateUpdatedAt);
    const {estimate,agreements:locked,agreementIds:ordered}=scope;
    if(locked.length!==ids.length||locked.some(row=>!ids.includes(row.id)))
      throw new Error("The requested reserve allocations must cover every prepared agreement.");
    const all=locked;
    const settings=await tx.businessSettings.findUniqueOrThrow({
      where:{id:"singleton"},select:{largeOrderMachineThreshold:true}});
    const machineCount=machineCountFromLines(estimate.lineItems);
    const eligible=commercialEligible(estimate.customer,machineCount,settings.largeOrderMachineThreshold);
    const total=sumCents(proposals.map(row=>row.amountCents));
    if(total!==estimate.depositCents)
      throw new Error("The per-property reserve amounts must equal the negotiated total exactly.");
    if(!eligible&&total>0)
      throw new Error("A household does not owe a refundable security reserve.");
    const byId=new Map(proposals.map(row=>[row.agreementId,row]));
    const revisionById=new Map(input.expectedRevisions.map(row=>[row.agreementId,row.revision]));
    const changed:string[]=[];
    const now=new Date();
    for(const agreement of locked){
      const old=readCommercialReserveHistory(agreement.commercialReservePolicyVersions);
      const last=old.at(-1);
      if((last?.revision??null)!==revisionById.get(agreement.id) ||
         (last&&last.amountCents!==agreement.depositCents))
        throw new Error("Another owner updated a reserve; reload the quote before applying changes.");
      const row=byId.get(agreement.id)!;
      const next=nextCommercialReserveRevision({
        previous:agreement.commercialReservePolicyVersions,
        agreementId:agreement.id,estimateId:estimate.id,
        amountCents:row.amountCents,replenishment:row.replenishment,
        termsReference:row.termsReference,actorUserId:input.actorUserId,
        reason:input.reason,recordedAt:now,
      });
      if(!next.changed)continue;
      await tx.rentalAgreement.update({where:{id:agreement.id},data:{
        depositCents:row.amountCents,commercialReservePolicyVersions:next.versions,
      }});
      changed.push(agreement.id);
    }
    if(changed.length){
      await tx.agreementSigningCharge.deleteMany({
        where:{agreementId:{in:ordered},frozenAt:null}});
      await tx.estimate.update({where:{id:estimate.id},data:{
        reviewedQuoteFingerprint:null,reviewedOrderFingerprint:null,reviewedQuoteAt:null,
      }});
      await tx.auditLog.create({data:{
        userId:input.actorUserId,action:"estimate.commercial_reserve_allocation",
        entityType:"Estimate",entityId:estimate.id,
        oldValue:{amounts:all.map(a=>({agreementId:a.id,cents:a.depositCents}))},
        newValue:{
          agreedTotalCents:total,agreements:proposals,
          affectedAgreements:changed,
          reason:input.reason.trim(),counselReview:"REVIEW_REQUIRED",
          note:"Versioned draft reserve terms only; no deposit collected or liability settled",
        },
      }});
    }
    return {estimateId:estimate.id,allocatedCents:total,
      changedAgreementIds:changed,status:"REVIEW_REQUIRED" as const};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:20_000});
}
