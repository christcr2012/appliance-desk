import { createHash } from "node:crypto";
import { Prisma, type ExportMode, type ExportTarget } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { postPending } from "@/domains/books/post";
import { formatBookExport, type ExportEntry, ExportIntegrityError } from "./formatters";
import { checkedQboIdentity, deliveryIsConfirmed } from "./delivery";

export type ExportInput = {
  target: ExportTarget; mode: ExportMode; from: string; to: string; onlyNotYetExported: boolean;
  qboTenantLabel?: string; qboEdition?: string; qboSummaryRiskAccepted?: boolean;
};
export const TARGETS: ExportTarget[] = ["QBO_JOURNAL_CSV","XERO_JOURNAL_CSV","GENERIC_JOURNAL_CSV","CASH_MOVEMENTS_CSV"];
export const MODES: ExportMode[] = ["DETAIL","DAILY_SUMMARY"];
const MAX_DAYS=366, MAX_ENTRIES=5000;
function validInput(input:ExportInput) {
  if (!TARGETS.includes(input.target) || !MODES.includes(input.mode))
    throw new ExportIntegrityError("Unsupported export target or mode.");
  if(input.target==="QBO_JOURNAL_CSV") {
    checkedQboIdentity(input.qboTenantLabel??"",input.qboEdition??"");
    if(input.mode==="DAILY_SUMMARY"&&!input.qboSummaryRiskAccepted)
      throw new ExportIntegrityError("QuickBooks daily summary loses individual bank matching. Explicitly accept this advanced risk.");
  }
  const from=businessDateFromKey(input.from), to=businessDateFromKey(input.to);
  if(!from||!to||businessDateKey(from)!==input.from||businessDateKey(to)!==input.to)
    throw new ExportIntegrityError("Choose real Colorado from and through dates.");
  if(from>to || (to.getTime()-from.getTime())/86400000>MAX_DAYS)
    throw new ExportIntegrityError("Choose at most 366 days, oldest date first.");
  const next=new Date(input.to+"T00:00:00Z");
  next.setUTCDate(next.getUTCDate()+1);
  const until=businessDateFromKey(next.toISOString().slice(0,10))!;
  return {from,to,until};
}
function payoutEnabled(value:unknown,target:ExportTarget) {
  if(!value||typeof value!=="object"||Array.isArray(value))return false;
  const flag=(value as Record<string,unknown>)[target];
  return flag===true; // No implicit payout recording or guessed policy.
}
const digest = (content:string)=>createHash("sha256").update(content,"utf8").digest("hex");
function safeFilename(target:ExportTarget,mode:ExportMode,from:string,to:string){
  return "books-"+target.toLowerCase()+"-"+mode.toLowerCase()+"-"+from+"_"+to+".csv";
}
type Tx=Prisma.TransactionClient;
async function liveRole(tx:Tx,userId:string) {
  await assertActiveTeamActor(tx,userId,["OWNER","ADMIN"]);
}
export async function runExport(userId:string,input:ExportInput):Promise<{batchId:string;alreadyImported?:boolean}|{blocked:string[]}> {
  const interval=validInput(input);
  // The source catch-up is not a provider-money operation. It must not start
  // before checking the calling user's current DB role.
  await prisma.$transaction(tx=>liveRole(tx,userId));
  const posting=await postPending({limit:500});
  if(posting.problems.length || posting.posted>=500)
    return {blocked:["Some accounting sources still need posting or owner review. Resolve them and retry the export."]};
  return prisma.$transaction(async tx=>{
    await liveRole(tx,userId);
    // Serialize overlapping exports for this target, including 'only new'
    // requests with different date ranges; the anti-join is now atomic.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"books-export:"+input.target}))::text AS locked`;
    const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},
      select:{booksStartDate:true,exportPayoutLines:true}});
    if(!settings?.booksStartDate)
      return {blocked:["The owner must initialize Books before exporting journal evidence."]};
    if(interval.from<settings.booksStartDate)
      return {blocked:["The date range starts before the owner-attested Books opening date."]};
    const where:Prisma.JournalEntryWhereInput={
      entryDate:{gte:interval.from,lt:interval.until},
      ...(input.onlyNotYetExported&&input.target!=="QBO_JOURNAL_CSV"?{exports:{none:{batch:{target:input.target}}}}:{}),
    };
    const selected=await tx.journalEntry.findMany({
      where,orderBy:[{entryDate:"asc"},{entryNumber:"asc"}],take:MAX_ENTRIES+1,
      include:{lines:{include:{ledgerAccount:{include:{mappings:{where:{target:input.target}}}}}}},
    });
    if(selected.length>MAX_ENTRIES)
      return {blocked:["Too many entries for a safe export. Choose a shorter date range."]};
    const payoutFlag=payoutEnabled(settings.exportPayoutLines,input.target);
    let eligible=selected.filter(entry=>{
      if(entry.eventKind==="STRIPE_PAYOUT"&&!payoutFlag)return false;
      if(input.target==="CASH_MOVEMENTS_CSV")return entry.lines.some(x=>
        (x.ledgerAccount.isPaymentSource||x.ledgerAccount.systemRole==="STRIPE_CLEARING") &&
        (x.debitCents!==0||x.creditCents!==0));
      return true;
    });
    // A remote CSV import has no guaranteed idempotency. Inspect all QBO
    // linked sources regardless of onlyNew or date-window overlaps.
    let replacesDeliveryId: string | undefined;
    if(input.target==="QBO_JOURNAL_CSV"&&eligible.length) {
      const links=await tx.exportBatchEntry.findMany({where:{
        journalEntryId:{in:eligible.map(x=>x.id)},batch:{target:"QBO_JOURNAL_CSV"},
      },select:{journalEntryId:true,batch:{select:{
        id:true,createdAt:true,accountingDelivery:{select:{id:true,status:true}},
      }}}});
      if(links.some(x=>!x.batch.accountingDelivery||x.batch.accountingDelivery.status==="PREPARED"))
        return {blocked:["An older QuickBooks export could already have been imported. Review its outcome and record an owner decision before another overlapping CSV."]};
      const confirmed=new Set(links.filter(x=>deliveryIsConfirmed(x.batch.accountingDelivery?.status??""))
        .map(x=>x.journalEntryId));
      const priorConfirmed=links.find(x=>deliveryIsConfirmed(x.batch.accountingDelivery?.status??""));
      const failed=links.filter(x=>x.batch.accountingDelivery?.status==="FAILED_BEFORE_IMPORT")
        .sort((a,b)=>b.batch.createdAt.getTime()-a.batch.createdAt.getTime());
      replacesDeliveryId=failed[0]?.batch.accountingDelivery?.id;
      eligible=eligible.filter(x=>!confirmed.has(x.id));
      if(!eligible.length&&priorConfirmed)
        return {batchId:priorConfirmed.batch.id,alreadyImported:true};
    }
    if(!eligible.length) {
      if(input.onlyNotYetExported&&input.target!=="QBO_JOURNAL_CSV") {
        const prior=await tx.exportBatch.findFirst({where:{
          target:input.target,mode:input.mode,periodFrom:interval.from,periodTo:interval.to,
        },orderBy:{createdAt:"desc"},select:{id:true}});
        if(prior)return {batchId:prior.id};
      }
      return {blocked:["There are no eligible journal entries in this selection."]};
    }
    const missing=new Set<string>();
    const entries:ExportEntry[]=eligible.map(entry=>({
      id:entry.id,entryNumber:entry.entryNumber,entryDate:entry.entryDate,
      memo:entry.memo,sourceType:entry.sourceType,eventKind:entry.eventKind,
      lines:entry.lines.map(line=>{
        const account=line.ledgerAccount;
        const mapping=account.mappings[0];
        if(!account.active||!mapping?.externalName?.trim())missing.add(account.name);
        return {
          ledgerAccountId:account.id,accountName:account.name,
          externalName:mapping?.externalName??"",externalTaxRate:mapping?.externalTaxRate??null,
          isPaymentSource:account.isPaymentSource,systemRole:account.systemRole,
          debitCents:line.debitCents,creditCents:line.creditCents,
        };
      }),
    }));
    if(missing.size)return {blocked:[...missing].sort().map(name=>"Map an active account for "+input.target+": "+name)};
    const content=formatBookExport(input.target,input.mode,entries);
    const hash=digest(content);
    // Equal rendered daily-summary bytes do NOT imply equal underlying journals.
    // Reuse an archive only when its exact journal-source set matches.
    const candidateBatches=await tx.exportBatch.findMany({where:{
      target:input.target,mode:input.mode,periodFrom:interval.from,periodTo:interval.to,contentSha256:hash,
    },orderBy:{createdAt:"desc"},take:100,select:{
      id:true,entryCount:true,accountingDelivery:{select:{status:true}},entries:{select:{journalEntryId:true}},
    }});
    const sourceIds=new Set(entries.map(entry=>entry.id));
    const old=candidateBatches.find(batch=>(input.target!=="QBO_JOURNAL_CSV" ||
      batch.accountingDelivery?.status!=="FAILED_BEFORE_IMPORT") && batch.entryCount===sourceIds.size &&
      batch.entries.length===sourceIds.size &&
      batch.entries.every(link=>sourceIds.has(link.journalEntryId)));
    if(old)return {batchId:old.id};
    const batch=await tx.exportBatch.create({data:{
      target:input.target,mode:input.mode,periodFrom:interval.from,periodTo:interval.to,
      fileName:safeFilename(input.target,input.mode,input.from,input.to),
      content,contentSha256:hash,entryCount:entries.length,createdByUserId:userId,
      entries:{create:entries.map(entry=>({journalEntryId:entry.id}))},
      ...(input.target==="QBO_JOURNAL_CSV"?{accountingDelivery:{create:{
        status:"PREPARED",tenantLabel:input.qboTenantLabel!.trim(),edition:input.qboEdition!,
        periodKey:input.from.slice(0,7),...(replacesDeliveryId?{replacesDeliveryId}:{})
      }}}:{}),
    }});
    await tx.auditLog.create({data:{
      userId,action:"books.export.generate",entityType:"ExportBatch",entityId:batch.id,
      newValue:{target:input.target,mode:input.mode,from:input.from,to:input.to,
        entryCount:entries.length,sha256:hash,onlyNew:input.onlyNotYetExported,
        delivery:input.target==="QBO_JOURNAL_CSV"?"PREPARED":null,replacesDeliveryId:replacesDeliveryId??null},
    }});
    return {batchId:batch.id};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30_000});
}
export async function getBookExportHistory(userId:string) {
  return prisma.$transaction(async tx=>{
    await liveRole(tx,userId);
    return tx.exportBatch.findMany({orderBy:[{createdAt:"desc"},{id:"desc"}],take:100,
      select:{id:true,target:true,mode:true,periodFrom:true,periodTo:true,fileName:true,
        contentSha256:true,entryCount:true,createdAt:true,
        accountingDelivery:{select:{id:true,status:true,tenantLabel:true,edition:true,memo:true,
          confirmedAt:true,version:true,privateEvidenceId:true}}}});
  });
}
export async function readBookExport(userId:string,id:string) {
  if(!id||id.length>150)throw new ExportIntegrityError("Invalid export identity.");
  return prisma.$transaction(async tx=>{
    await liveRole(tx,userId);
    const file=await tx.exportBatch.findUnique({where:{id},select:{
      content:true,contentSha256:true,fileName:true,target:true,entryCount:true,
    }});
    if(!file)throw new ExportIntegrityError("Export not found.");
    if(digest(file.content)!==file.contentSha256)
      throw new ExportIntegrityError("Archived export content failed its SHA-256 check.");
    return file;
  });
}
