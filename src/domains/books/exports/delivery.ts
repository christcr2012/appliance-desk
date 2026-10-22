import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { ExportIntegrityError } from "./formatters";

/** PREPARED also represents an uncertain remote import. The SQL enum deliberately
 * refuses a fabricated remote success or a second silent import attempt. */
export const QBO_EDITIONS = ["FREE","SIMPLE_START","ESSENTIALS","PLUS","OTHER"] as const;
export type QboEdition = typeof QBO_EDITIONS[number];
export type DeliveryDecision = "UNCERTAIN"|"FAILED_BEFORE_IMPORT"|"IMPORT_CONFIRMED"|"RECONCILIATION_CONFIRMED";
export type DeliveryReview = {
  deliveryId:string;expectedVersion:number;decision:DeliveryDecision;reference:string;note:string;
  importedCount?:number; balanced?:boolean;bankMatched?:boolean;statementChecked?:boolean;neverStarted?:boolean;
};
export const deliveryIsConfirmed=(s:string)=>s==="IMPORT_CONFIRMED"||s==="RECONCILIATION_CONFIRMED";
function checkedText(value:string,label:string,max:number,min=3) {
  const text=value.trim();
  if(text.length<min||text.length>max||/[\u0000-\u001f\u007f]/.test(text))
    throw new ExportIntegrityError("Enter a valid "+label+" ("+min+"–"+max+" characters).");
  return text;
}
export function checkedQboIdentity(tenantLabel:string,edition:string) {
  const label=checkedText(tenantLabel,"QuickBooks company label",100);
  if(!QBO_EDITIONS.includes(edition as QboEdition))throw new ExportIntegrityError("Choose a QuickBooks edition or Other.");
  return {tenantLabel:label,edition};
}

/** K-5 legacy exports lack a delivery record and must not silently be
 * counted imported or safe to export again. OWNER registers them as uncertain. */
export async function registerQboDelivery(actorId:string,batchId:string,tenantLabel:string,edition:string) {
  const identity=checkedQboIdentity(tenantLabel,edition);
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,actorId,["OWNER"]);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"books-export:QBO_JOURNAL_CSV"}))::text AS locked`;
    const batch=await tx.exportBatch.findUnique({where:{id:batchId},select:{
      id:true,target:true,periodFrom:true,accountingDelivery:{select:{id:true}},
    }});
    if(!batch||batch.target!=="QBO_JOURNAL_CSV")throw new ExportIntegrityError("QuickBooks export batch not found.");
    if(batch.accountingDelivery)return {id:batch.accountingDelivery.id,existing:true};
    const created=await tx.accountingDelivery.create({data:{
      exportBatchId:batch.id,status:"PREPARED",tenantLabel:identity.tenantLabel,
      edition:identity.edition,periodKey:batch.periodFrom.toISOString().slice(0,7),
    }});
    await tx.auditLog.create({data:{userId:actorId,action:"books.qbo.delivery.register",
      entityType:"AccountingDelivery",entityId:created.id,
      newValue:{batchId:batch.id,edition:created.edition,status:created.status}}});
    return {id:created.id,existing:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}

/** Manual, owner-attested outcome. A PREPARED batch blocks new exports until
 * either genuine trial proof is entered or owner knows import never started. */
export async function decideQboDelivery(actorId:string,review:DeliveryReview) {
  if(!Number.isSafeInteger(review.expectedVersion)||review.expectedVersion<1||
    !["UNCERTAIN","FAILED_BEFORE_IMPORT","IMPORT_CONFIRMED","RECONCILIATION_CONFIRMED"].includes(review.decision))
    throw new ExportIntegrityError("Invalid delivery decision or version.");
  const reference=checkedText(review.reference,"trial-company evidence reference",180,8);
  const note=checkedText(review.note,"review note",700,12);
  return prisma.$transaction(async tx=>{
    await assertActiveTeamActor(tx,actorId,["OWNER"]);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"books-export:QBO_JOURNAL_CSV"}))::text AS locked`;
    const existing=await tx.accountingDelivery.findUnique({where:{id:review.deliveryId},
      include:{batch:{select:{target:true,entryCount:true}}}});
    if(!existing||existing.batch.target!=="QBO_JOURNAL_CSV")
      throw new ExportIntegrityError("Accounting delivery not found.");
    const status=review.decision==="UNCERTAIN"?"PREPARED":review.decision;
    const memo=JSON.stringify({reference,note,
      importedCount:review.decision==="IMPORT_CONFIRMED"?review.importedCount:null,
      checkedBankAndStatement:review.decision==="IMPORT_CONFIRMED"||review.decision==="RECONCILIATION_CONFIRMED"});
    if(existing.status===status&&existing.memo===memo&&existing.version===review.expectedVersion+1)
      return {status:existing.status,version:existing.version,replayed:true};
    if(existing.version!==review.expectedVersion)
      throw new ExportIntegrityError("This delivery changed. Reload before another decision.");
    if(["FAILED_BEFORE_IMPORT","RECONCILIATION_CONFIRMED"].includes(existing.status))
      throw new ExportIntegrityError("That final delivery decision is immutable.");
    if(existing.status==="IMPORT_CONFIRMED"&&status!=="RECONCILIATION_CONFIRMED")
      throw new ExportIntegrityError("An imported batch cannot later be marked unimported.");
    if(status==="RECONCILIATION_CONFIRMED"&&existing.status!=="IMPORT_CONFIRMED")
      throw new ExportIntegrityError("First confirm the trial import and journal counts.");
    if(status==="FAILED_BEFORE_IMPORT"&&!review.neverStarted)
      throw new ExportIntegrityError("Only mark failed-before-import if no remote import ever started; otherwise leave uncertain.");
    if(status==="IMPORT_CONFIRMED"&&(review.importedCount!==existing.batch.entryCount||
      !review.balanced||!review.bankMatched||!review.statementChecked))
      throw new ExportIntegrityError("Confirm trial journal counts, balance, bank matches and statement first.");
    if(status==="RECONCILIATION_CONFIRMED"&&(!review.bankMatched||!review.statementChecked))
      throw new ExportIntegrityError("Check bank matching and statement proof.");
    const now=new Date();
    const changed=await tx.accountingDelivery.update({where:{id:existing.id,version:existing.version},data:{
      status,memo,version:{increment:1},
      ...(status==="IMPORT_CONFIRMED"?{confirmedAt:now,confirmedByUserId:actorId}:{}),
      ...(["FAILED_BEFORE_IMPORT","RECONCILIATION_CONFIRMED"].includes(status)?
        {resolvedAt:now,resolvedByUserId:actorId,resolvedReason:note}:{})
    }});
    await tx.auditLog.create({data:{userId:actorId,action:"books.qbo.delivery.review",
      entityType:"AccountingDelivery",entityId:existing.id,
      oldValue:{status:existing.status,version:existing.version},
      newValue:{status:changed.status,version:changed.version,reference}}});
    return {status:changed.status,version:changed.version,replayed:false};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
