import { createHash } from "node:crypto";
import { Prisma, type ExportMode, type ExportTarget } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { postPending } from "@/domains/books/post";
import { formatBookExport, type ExportEntry, ExportIntegrityError } from "./formatters";

export type ExportInput = {
  target: ExportTarget; mode: ExportMode; from: string; to: string; onlyNotYetExported: boolean;
};
export const TARGETS: ExportTarget[] = ["QBO_JOURNAL_CSV","XERO_JOURNAL_CSV","GENERIC_JOURNAL_CSV","CASH_MOVEMENTS_CSV"];
export const MODES: ExportMode[] = ["DETAIL","DAILY_SUMMARY"];
const MAX_DAYS=366, MAX_ENTRIES=5000;
function validInput(input:ExportInput) {
  if (!TARGETS.includes(input.target) || !MODES.includes(input.mode))
    throw new ExportIntegrityError("Unsupported export target or mode.");
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
export async function runExport(userId:string,input:ExportInput):Promise<{batchId:string}|{blocked:string[]}> {
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
      ...(input.onlyNotYetExported?{exports:{none:{batch:{target:input.target}}}}:{}),
    };
    const selected=await tx.journalEntry.findMany({
      where,orderBy:[{entryDate:"asc"},{entryNumber:"asc"}],take:MAX_ENTRIES+1,
      include:{lines:{include:{ledgerAccount:{include:{mappings:{where:{target:input.target}}}}}}},
    });
    if(selected.length>MAX_ENTRIES)
      return {blocked:["Too many entries for a safe export. Choose a shorter date range."]};
    const payoutFlag=payoutEnabled(settings.exportPayoutLines,input.target);
    const eligible=selected.filter(entry=>{
      if(entry.eventKind==="STRIPE_PAYOUT"&&!payoutFlag)return false;
      if(input.target==="CASH_MOVEMENTS_CSV")return entry.lines.some(x=>
        (x.ledgerAccount.isPaymentSource||x.ledgerAccount.systemRole==="STRIPE_CLEARING") &&
        (x.debitCents!==0||x.creditCents!==0));
      return true;
    });
    if(!eligible.length) {
      if(input.onlyNotYetExported) {
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
    const old=await tx.exportBatch.findFirst({where:{
      target:input.target,mode:input.mode,periodFrom:interval.from,periodTo:interval.to,contentSha256:hash,
    },orderBy:{createdAt:"desc"},select:{id:true,entryCount:true}});
    if(old && old.entryCount===entries.length)return {batchId:old.id};
    const batch=await tx.exportBatch.create({data:{
      target:input.target,mode:input.mode,periodFrom:interval.from,periodTo:interval.to,
      fileName:safeFilename(input.target,input.mode,input.from,input.to),
      content,contentSha256:hash,entryCount:entries.length,createdByUserId:userId,
      entries:{create:entries.map(entry=>({journalEntryId:entry.id}))},
    }});
    await tx.auditLog.create({data:{
      userId,action:"books.export.generate",entityType:"ExportBatch",entityId:batch.id,
      newValue:{target:input.target,mode:input.mode,from:input.from,to:input.to,
        entryCount:entries.length,sha256:hash,onlyNew:input.onlyNotYetExported},
    }});
    return {batchId:batch.id};
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30_000});
}
export async function getBookExportHistory(userId:string) {
  return prisma.$transaction(async tx=>{
    await liveRole(tx,userId);
    return tx.exportBatch.findMany({orderBy:[{createdAt:"desc"},{id:"desc"}],take:100,
      select:{id:true,target:true,mode:true,periodFrom:true,periodTo:true,fileName:true,
        contentSha256:true,entryCount:true,createdAt:true}});
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
