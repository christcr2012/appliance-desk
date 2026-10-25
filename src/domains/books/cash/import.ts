import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { previewToken as signPreviewToken, verifyToken as verifySignedPreviewToken } from "@/lib/preview-token";
import { CashEvidenceError } from "./accounts";
import { canonicalMapping, parseBankCsv, type BankCsvMapping, type ParsedObservation } from "./csv";

const MINUTE=60000;
type PreviewClaims={v:1;uid:string;aid:string;sha:string;mappingHash:string;version:number;exp:number};
type OverlapChoice="KEEP_EXISTING"|"ADDITIONAL";
export type BankImportChoices={overlaps?:Record<number,OverlapChoice>;supersedeReason?:string};
const TOKEN_ERRORS={label:"Bank preview",error:(message:string)=>new CashEvidenceError(message)};
function previewToken(claim:PreviewClaims){
 return signPreviewToken(claim,TOKEN_ERRORS);
}
function verifyToken(token:string):PreviewClaims{
 const claim=verifySignedPreviewToken(token,TOKEN_ERRORS) as PreviewClaims;
 if(claim.v!==1||!Number.isSafeInteger(claim.exp)||claim.exp<Date.now()||claim.exp>Date.now()+31*MINUTE||
   typeof claim.uid!=="string"||typeof claim.aid!=="string"||
   !/^[a-f0-9]{64}$/.test(claim.sha)||!/^[a-f0-9]{64}$/.test(claim.mappingHash))
  throw new CashEvidenceError("Bank preview has expired or is invalid; preview again.");
 return claim;
}
async function previewOverlaps(tx:Prisma.TransactionClient,accountId:string,rows:ParsedObservation[]){
 const active=await tx.bankObservation.findMany({
  where:{cashAccountId:accountId,isActive:true},
  select:{id:true,externalId:true,fingerprint:true,description:true,postedOn:true,signedCents:true,occurrenceIndex:true},take:10000,
 });
 if(active.length===10000)throw new CashEvidenceError("Observation history is too large to safely preview; narrow the account evidence.");
 const byExternal=new Map(active.filter(x=>x.externalId).map(x=>[x.externalId!,x]));
 const multiplicities=new Map<string,number>();
 for(const e of active)multiplicities.set(e.fingerprint,Math.max(e.occurrenceIndex,multiplicities.get(e.fingerprint)??0));
 const duplicates:number[]=[],ambiguous:number[]=[],conflicts:number[]=[];
 for(const row of rows){
  if(row.externalId){
   const prev=byExternal.get(row.externalId);
   if(!prev)continue;
   if(prev.fingerprint!==row.fingerprint)conflicts.push(row.rowNumber);
   else duplicates.push(row.rowNumber);
  }else if(multiplicities.has(row.fingerprint)){
   // Fingerprints are NOT unique: only explicit operator decision resolves ambiguous overlap.
   ambiguous.push(row.rowNumber);
  }
 }
 return {duplicates,ambiguous,conflicts};
}
export async function previewBankImport(userId:string,accountId:string,bytes:Uint8Array,mapping:BankCsvMapping){
 const parsed=parseBankCsv(bytes,mapping);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const account=await tx.cashAccount.findUnique({where:{id:accountId},
    select:{id:true,version:true,active:true,currency:true}});
  if(!account?.active||account.currency!=="USD")throw new CashEvidenceError("Select an active USD cash account.");
  const overlap=await previewOverlaps(tx,accountId,parsed.rows);
  return {
   token:previewToken({v:1,uid:userId,aid:accountId,sha:parsed.sha256,mappingHash:parsed.mappingHash,
    version:account.version,exp:Date.now()+30*MINUTE}),
   sha256:parsed.sha256,mappingHash:parsed.mappingHash,
   count:parsed.rows.length,firstTwenty:parsed.firstTwenty,
   totalInflowsCents:parsed.totalInflowsCents,totalOutflowsCents:parsed.totalOutflowsCents,
   overlap,problems:overlap.conflicts.map(row=>"Bank transaction ID has conflicting evidence at row "+row),
  };
 });
}
export async function commitBankImport(userId:string,accountId:string,bytes:Uint8Array,
 mapping:BankCsvMapping,token:string,commandKey:string,choices:BankImportChoices={}){
 const claim=verifyToken(token),parsed=parseBankCsv(bytes,mapping);
 if(claim.uid!==userId||claim.aid!==accountId||
   claim.sha!==parsed.sha256||claim.mappingHash!==parsed.mappingHash)
  throw new CashEvidenceError("Bank CSV or selected mapping changed after preview.");
 if(!/^[A-Za-z0-9_-]{10,120}$/.test(commandKey))
  throw new CashEvidenceError("Bank import command key is invalid.");
 const normalized=canonicalMapping(mapping);
 return prisma.$transaction(async tx=>{
  const actor=await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  await tx.$queryRaw`SELECT "id" FROM "CashAccount" WHERE "id"=${accountId} FOR UPDATE`;
  const cash=await tx.cashAccount.findUnique({where:{id:accountId}});
  if(!cash?.active||cash.currency!=="USD"||cash.version!==claim.version)
   throw new CashEvidenceError("Account changed after bank import preview.");
  // The same raw bytes must have only one active interpretation.
  const earlier=await tx.bankImport.findFirst({where:{cashAccountId:accountId,sha256:parsed.sha256,
   status:"ACTIVE"},include:{observations:{select:{id:true}}}});
  if(earlier&&earlier.mappingHash===parsed.mappingHash)return earlier.id;
  if(earlier){
   if(actor.role!=="OWNER"||!choices.supersedeReason?.trim()||choices.supersedeReason.trim().length>250)
    throw new CashEvidenceError("Correcting a mapped bank import requires owner review and a reason.");
   const ids=earlier.observations.map(x=>x.id);
   if(await tx.bankMatchItem.count({where:{bankObservationId:{in:ids},active:true}}))
    throw new CashEvidenceError("A bank match must be reviewed and voided before reinterpreting the source.");
   if(await tx.bankReconciliation.count({where:{cashAccountId:accountId,status:"COMPLETED",isCurrent:true}}))
    throw new CashEvidenceError("Reopen any dependent completed statements before changing the bank file mapping.");
  }
  const overlap=await previewOverlaps(tx,accountId,parsed.rows);
  if(overlap.conflicts.length)throw new CashEvidenceError("The bank re-used a transaction ID with different evidence.");
  if(overlap.ambiguous.length){
   if(actor.role!=="OWNER")throw new CashEvidenceError("Only OWNER can resolve potentially duplicated bank observations.");
   for(const n of overlap.ambiguous)if(!["KEEP_EXISTING","ADDITIONAL"].includes(choices.overlaps?.[n]??""))
    throw new CashEvidenceError("Each ambiguous bank row needs an explicit reviewed keep/additional decision.");
  }
  // Account lock guards revisions and deduplication. Source observations remain
  // permanently readable after a corrected mapping supersedes their activity.
  if(earlier){
   await tx.bankImport.update({where:{id:earlier.id},data:{
    status:"SUPERSEDED",supersededAt:new Date(),supersededByUserId:userId,
    supersededReason:choices.supersedeReason!.trim(),
   }});
   await tx.bankObservation.updateMany({where:{importId:earlier.id},
    data:{status:"SUPERSEDED",isActive:false,version:{increment:1}}});
  }
  const revisions=await tx.bankImport.findMany({where:{cashAccountId:accountId,sha256:parsed.sha256},
   select:{mappingRevision:true},orderBy:{mappingRevision:"desc"},take:1});
  const nextRevision=(revisions[0]?.mappingRevision??0)+1;
  const imported=await tx.bankImport.create({data:{
   cashAccountId:accountId,sha256:parsed.sha256,
   mapping:normalized,mappingHash:parsed.mappingHash,
   mappingRevision:nextRevision,rowCount:parsed.rows.length,
   importedByUserId:userId,supersedesImportId:earlier?.id,
  }});
  let accepted=0,ignored=0;
  // Prevent accidental merging of legitimate same-day identical charges.
  const active=await tx.bankObservation.findMany({where:{cashAccountId:accountId,isActive:true},
   select:{externalId:true,fingerprint:true,occurrenceIndex:true},take:10000});
  const external=new Set(active.flatMap(x=>x.externalId?[x.externalId]:[]));
  const fingerprintCounts=new Map<string,number>();
  for(const row of active)fingerprintCounts.set(row.fingerprint,
   Math.max(fingerprintCounts.get(row.fingerprint)??0,row.occurrenceIndex));
  for(const row of parsed.rows){
   if(row.externalId&&external.has(row.externalId)){ignored++;continue;}
   if(!row.externalId&&choices.overlaps?.[row.rowNumber]==="KEEP_EXISTING"){ignored++;continue;}
   const occurrence=(fingerprintCounts.get(row.fingerprint)??0)+1;
   fingerprintCounts.set(row.fingerprint,occurrence);
   await tx.bankObservation.create({data:{
    cashAccountId:accountId,importId:imported.id,rowNumber:row.rowNumber,
    postedOn:row.postedOn,signedCents:row.signedCents,description:row.description,
    externalId:row.externalId,fingerprint:row.fingerprint,occurrenceIndex:occurrence,
   }});
   if(row.externalId)external.add(row.externalId);
   accepted++;
  }
  await tx.auditLog.create({data:{userId,action:earlier?"books.bank.import.correct":"books.bank.import",
   entityType:"BankImport",entityId:imported.id,newValue:{
    sha256:parsed.sha256,mappingHash:parsed.mappingHash,fromId:earlier?.id,
    accepted,duplicatesIgnored:ignored,reason:choices.supersedeReason??null,commandKey,
   }}});
  return imported.id;
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
export async function listBankEvidence(userId:string,accountId:string){
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
  const account=await tx.cashAccount.findUnique({where:{id:accountId},select:{id:true,active:true}});
  if(!account)throw new CashEvidenceError("Bank source not found.");
  return tx.bankImport.findMany({where:{cashAccountId:accountId},
   orderBy:[{createdAt:"desc"},{mappingRevision:"desc"}],take:50,
   select:{id:true,sha256:true,mappingHash:true,mappingRevision:true,rowCount:true,status:true,
    createdAt:true,supersedesImportId:true,supersededReason:true,
    observations:{where:{isActive:true},select:{id:true,postedOn:true,signedCents:true,description:true,status:true},
      orderBy:{rowNumber:"asc"},take:100}},
  });
 });
}
