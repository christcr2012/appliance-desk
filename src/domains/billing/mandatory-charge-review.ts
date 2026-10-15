import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { MandatoryChargeDecision } from "@/domains/billing/signing-mandatory-policy";

export const MANDATORY_CHARGE_KINDS=[
  "delivery","installation","removal","damageWaiver",
] as const;
export type MandatoryChargeKind=typeof MANDATORY_CHARGE_KINDS[number];
export type LocationChargeChoice="REQUIRED"|"NOT_APPLICABLE";
export type MandatoryLocationChoice={
  agreementId:string;
  decisions:Record<MandatoryChargeKind,LocationChargeChoice>;
  /** Required for EACH local exception to the global mandatory policy. */
  exceptionReasons:Partial<Record<MandatoryChargeKind,string>>;
  retailDeliveryEvent:boolean;
};
export type VerifiedOneTimeCharge={kind:MandatoryChargeKind;amountCents:number;
  decision:LocationChargeChoice;reason:string|null};
export type MandatoryTaxEvidence={
  status:"VERIFIED"|"REVIEW_REQUIRED";
  taxCents:number|null;
  lines:Array<{lineKey:string;jurisdictionId:string;rateVersionId:string;
    category:string;taxableCents:number;exemptCents:number;taxCents:number}>;
  reasons:string[];
};
export type ReviewedMandatoryChargeRevision={
  schemaVersion:1;revision:number;
  estimateId:string;agreementId:string;serviceAddressId:string;
  actorUserId:string;recordedAt:string;reason:string;
  globalPolicyRevision:number;settingsUpdatedAt:string;
  charges:VerifiedOneTimeCharge[];
  tax:MandatoryTaxEvidence;
  retailDelivery:{
    event:boolean;status:"APPLIES"|"EXEMPT"|"UNDECIDED";
    amountCents:number|null;rateId:string|null;
    handling:"COLLECT_FROM_CUSTOMER"|"PAY_MYSELF"|"UNDECIDED";
    reason:string;
  };
  reserveRevision:number|null;
  reserveCents:number;
  sourceFingerprint:string;
  professionalReview:"REVIEW_REQUIRED";
};
const cent=(n:unknown):n is number=>
  typeof n==="number"&&Number.isSafeInteger(n)&&n>=0&&n<=100_000_000;
const safeId=(n:unknown):n is string=>
  typeof n==="string"&&n.length>0&&n.length<=256;
const reason=(v:unknown,min=12):v is string=>
  typeof v==="string"&&v.trim().length>=min&&v.length<=500;
function normalizedDetails(row:ReviewedMandatoryChargeRevision){
  return {
    estimateId:row.estimateId,agreementId:row.agreementId,
    serviceAddressId:row.serviceAddressId,
    globalPolicyRevision:row.globalPolicyRevision,
    settingsUpdatedAt:row.settingsUpdatedAt,
    charges:row.charges,tax:row.tax,retailDelivery:row.retailDelivery,
    reserveCents:row.reserveCents,reserveRevision:row.reserveRevision,
  };
}
export function mandatoryReviewFingerprint(input:Readonly<ReturnType<typeof normalizedDetails>>){
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}
export function validateLocalChargeChoice(input:unknown,global:MandatoryChargeDecision):MandatoryLocationChoice{
  if(!input||typeof input!=="object"||Array.isArray(input))
    throw new Error("Choose all service fee decisions for this address.");
  const row=input as Record<string,unknown>;
  if(!safeId(row.agreementId)||!row.decisions||typeof row.decisions!=="object"||
     Array.isArray(row.decisions)||!row.exceptionReasons||
     typeof row.exceptionReasons!=="object"||Array.isArray(row.exceptionReasons)||
     typeof row.retailDeliveryEvent!=="boolean")
    throw new Error("A complete reviewed service fee decision is required.");
  const decisions=row.decisions as Record<string,unknown>;
  const explanations=row.exceptionReasons as Record<string,unknown>;
  for(const kind of MANDATORY_CHARGE_KINDS){
    const owner=global[kind];
    const local=decisions[kind];
    if(owner==="UNDECIDED")
      throw new Error("First resolve the effective global policy for "+kind+".");
    if(local!=="REQUIRED"&&local!=="NOT_APPLICABLE")
      throw new Error("Review the "+kind+" service at every address.");
    if(owner==="NOT_APPLICABLE"&&local==="REQUIRED")
      throw new Error("A location cannot invent a mandatory "+kind+" fee contrary to policy.");
    if(owner==="REQUIRED"&&local==="NOT_APPLICABLE"&&!reason(explanations[kind]))
      throw new Error("Record why mandatory "+kind+" service is not applicable here.");
    if(explanations[kind]!==undefined&&
       (typeof explanations[kind]!=="string"||String(explanations[kind]).length>500))
      throw new Error("A local service exception reason is invalid.");
  }
  return {
    agreementId:row.agreementId as string,
    decisions:Object.fromEntries(MANDATORY_CHARGE_KINDS.map(kind=>
      [kind,decisions[kind]])) as MandatoryLocationChoice["decisions"],
    exceptionReasons:Object.fromEntries(MANDATORY_CHARGE_KINDS
      .filter(kind=>decisions[kind]==="NOT_APPLICABLE"&&global[kind]==="REQUIRED")
      .map(kind=>[kind,String(explanations[kind]).trim()])) as
      MandatoryLocationChoice["exceptionReasons"],
    retailDeliveryEvent:row.retailDeliveryEvent as boolean,
  };
}
export function mandatoryChargeAmounts(input:{
  global:MandatoryChargeDecision;choice:MandatoryLocationChoice;
  settings:{delivery:number;installation:number;removal:number;
    waiverEnabled:boolean};
  agreementWaiverCents:number;
}):VerifiedOneTimeCharge[]{
  const values:Record<MandatoryChargeKind,number>={
    delivery:input.settings.delivery,installation:input.settings.installation,
    removal:input.settings.removal,damageWaiver:input.agreementWaiverCents,
  };
  for(const kind of MANDATORY_CHARGE_KINDS){
    if(!cent(values[kind]))
      throw new Error("Invalid owner-configured "+kind+" amount.");
    if(kind==="damageWaiver"&&input.choice.decisions[kind]==="REQUIRED"&&
       !input.settings.waiverEnabled)
      throw new Error("Damage waiver must first be enabled and reviewed by the owner.");
    if(input.choice.decisions[kind]==="REQUIRED"&&values[kind]===0)
      throw new Error("Required "+kind+" needs a reviewed positive amount or a justified exception.");
    if(kind==="damageWaiver"&&input.choice.decisions[kind]==="NOT_APPLICABLE"&&
       values[kind]>0)
      throw new Error("An agreement's nonzero waiver contradicts the local not-applicable decision.");
  }
  return MANDATORY_CHARGE_KINDS.map(kind=>({
    kind,decision:input.choice.decisions[kind],
    amountCents:input.choice.decisions[kind]==="REQUIRED"?values[kind]:0,
    reason:input.choice.exceptionReasons[kind]??null,
  }));
}

/** Validate the complete historical JSON rather than trusting editable amounts. */
export function readMandatoryChargeHistory(raw:unknown):ReviewedMandatoryChargeRevision[]{
  if(!Array.isArray(raw)||raw.length>256)
    throw new Error("Stored mandatory-charge review history requires finance reconciliation.");
  const rows:ReviewedMandatoryChargeRevision[]=[];
  for(const value of raw){
    if(!value||typeof value!=="object"||Array.isArray(value))
      throw new Error("Stored mandatory-charge review history requires finance reconciliation.");
    const row=value as Record<string,unknown>;
    if(row.schemaVersion!==1||row.revision!==rows.length+1||
       !safeId(row.estimateId)||!safeId(row.agreementId)||
       !safeId(row.serviceAddressId)||!safeId(row.actorUserId)||
       !reason(row.reason)||typeof row.recordedAt!=="string"||
       !Number.isFinite(Date.parse(row.recordedAt))||
       !Number.isSafeInteger(row.globalPolicyRevision)||
       (row.globalPolicyRevision as number)<1||
       typeof row.settingsUpdatedAt!=="string"||
       !Number.isFinite(Date.parse(row.settingsUpdatedAt))||
       row.professionalReview!=="REVIEW_REQUIRED"||
       !cent(row.reserveCents)||
       (row.reserveRevision!==null&&
        (!Number.isSafeInteger(row.reserveRevision)||(row.reserveRevision as number)<1))||
       !Array.isArray(row.charges)||row.charges.length!==4||
       !row.tax||typeof row.tax!=="object"||Array.isArray(row.tax)||
       !row.retailDelivery||typeof row.retailDelivery!=="object"||
       Array.isArray(row.retailDelivery))
      throw new Error("Stored mandatory-charge review history requires finance reconciliation.");
    const charges=row.charges as Record<string,unknown>[];
    if(charges.some((x,i)=>!x||x.kind!==MANDATORY_CHARGE_KINDS[i]||
       !cent(x.amountCents)||!["REQUIRED","NOT_APPLICABLE"].includes(String(x.decision))||
       (x.decision==="NOT_APPLICABLE"&&x.amountCents!==0)||
       (x.reason!==null&&!reason(x.reason))))
      throw new Error("Stored mandatory-charge review has a broken fee allocation.");
    const current=row as unknown as ReviewedMandatoryChargeRevision;
    if(row.sourceFingerprint!==mandatoryReviewFingerprint(normalizedDetails(current)))
      throw new Error("Stored mandatory-charge review fingerprint does not match its amounts.");
    if(rows.some(prior=>prior.agreementId!==current.agreementId||
       prior.estimateId!==current.estimateId||
       prior.serviceAddressId!==current.serviceAddressId))
      throw new Error("Mandatory-charge review history crossed another customer/order.");
    rows.push(current);
  }
  return rows;
}
export function nextMandatoryChargeReview(input:{
  previous:unknown;revision:Omit<ReviewedMandatoryChargeRevision,
    "schemaVersion"|"revision"|"sourceFingerprint"|"professionalReview">;
}):{changed:boolean;current:ReviewedMandatoryChargeRevision;versions:Prisma.InputJsonValue}{
  const previous=readMandatoryChargeHistory(input.previous);
  if(previous.length===256)throw new Error("Mandatory review history reached its safe limit.");
  const candidate:ReviewedMandatoryChargeRevision={
    ...input.revision,schemaVersion:1,revision:previous.length+1,
    professionalReview:"REVIEW_REQUIRED",sourceFingerprint:"",
  };
  // A stable canonical projection, not the caller's object property order,
  // binds every stored charge/tax/RDF/reserve source cent.
  candidate.sourceFingerprint=mandatoryReviewFingerprint(normalizedDetails(candidate));
  // Never permit replacing a version with unrelated address/source identity.
  if(previous.some(row=>row.agreementId!==candidate.agreementId||
     row.estimateId!==candidate.estimateId||
     row.serviceAddressId!==candidate.serviceAddressId))
    throw new Error("Mandatory-charge review history does not belong to this draft.");
  const prior=previous.at(-1);
  if(prior&&prior.sourceFingerprint===candidate.sourceFingerprint){
    return {changed:false,current:prior,versions:previous as unknown as Prisma.InputJsonValue};
  }
  const versions=[...previous,candidate];
  readMandatoryChargeHistory(versions);
  return {changed:true,current:candidate,versions:versions as unknown as Prisma.InputJsonValue};
}
