import { createHash } from "node:crypto";
import { Prisma, type ExportTarget, type LedgerAccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { openingBalance } from "./posting-rules";
import { writeJournal } from "./post";

export type BooksActor = { id: string; role: "OWNER" | "ADMIN" | "STAFF" | "CUSTOMER" };
export class BooksPermissionError extends Error {}
export class BooksInputError extends Error {}
function allow(actor: BooksActor, ...roles: BooksActor["role"][]) {
  if (!roles.includes(actor.role)) throw new BooksPermissionError("This accounting action requires " + roles.join(" or ") + ".");
}
const periodKey = (key: string) => {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(key)) throw new BooksInputError("Choose a valid accounting month.");
  return key;
};
const safeCents = (amount: number) => {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 1_000_000_000)
    throw new BooksInputError("Enter a valid whole-cent amount between 0 and $10,000,000.");
  return amount;
};
const safeText = (text: string, max = 120) => {
  const clean = text.trim();
  if (!clean || clean.length > max) throw new BooksInputError("Enter a nonempty description within " + max + " characters.");
  return clean;
};

/** Explicit one-time owner-attested opening; never guess a Stripe balance. */
export async function initializeBooks(actor: BooksActor, input: {
  startDate: string; stripeCents: number; bankCents: number; cardCents: number;
}) {
  allow(actor,"OWNER");
  const start = businessDateFromKey(input.startDate);
  if (!start || businessDateKey(start) !== input.startDate)
    throw new BooksInputError("Choose an actual Colorado calendar date.");
  if (start.getTime() > Date.now()) throw new BooksInputError("Books cannot begin in a future month.");
  const stripe = safeCents(input.stripeCents);
  const bank = safeCents(input.bankCents);
  const card = safeCents(input.cardCents);
  return prisma.$transaction(async tx => {
    const before = await tx.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}});
    if (before?.booksStartDate || await tx.journalEntry.count())
      throw new BooksInputError("Books are already initialized; historical financial evidence cannot be reset.");
    await tx.businessSettings.upsert({where:{id:"singleton"},
      create:{id:"singleton",booksStartDate:start},update:{booksStartDate:start}});
    const plan = openingBalance({date:start, stripeCents:stripe,bankCents:bank,cardCents:card});
    if (plan) await writeJournal(tx,"OPENING",input.startDate,"OPENING_BALANCE",plan);
    await tx.auditLog.create({data:{
      userId:actor.id,action:"books.initialize",entityType:"BusinessSettings",entityId:"singleton",
      newValue:{booksStartDate:input.startDate,openingBalances:{stripeCents:stripe,bankCents:bank,cardCents:card}},
    }});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function renameAccount(actor:BooksActor, accountId:string, name:string) {
  allow(actor,"OWNER");
  const label=safeText(name);
  return prisma.$transaction(async tx=>{
    const current=await tx.ledgerAccount.findUnique({where:{id:accountId}});
    if(!current)throw new BooksInputError("Account does not exist.");
    await tx.ledgerAccount.update({where:{id:accountId},data:{name:label}});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.account.rename",
      entityType:"LedgerAccount",entityId:accountId,oldValue:{name:current.name},newValue:{name:label}}});
  });
}
export async function addCustomAccount(actor:BooksActor,input:{
  name:string; type:LedgerAccountType; isPaymentSource:boolean; description:string;
}) {
  allow(actor,"OWNER");
  if (!["ASSET","LIABILITY","EXPENSE"].includes(input.type))
    throw new BooksInputError("Custom accounts may be cash/assets, liabilities, or expense accounts.");
  const name=safeText(input.name), description=safeText(input.description,400);
  if(input.isPaymentSource && input.type==="EXPENSE") throw new BooksInputError("Expense accounts cannot be payment sources.");
  return prisma.$transaction(async tx=>{
    const account=await tx.ledgerAccount.create({data:{
      name,description,type:input.type,isPaymentSource:input.isPaymentSource,systemRole:null}});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.account.add",
      entityType:"LedgerAccount",entityId:account.id,newValue:{name,type:input.type,paymentSource:input.isPaymentSource}}});
    return account.id;
  });
}
export async function mapExportAccount(actor:BooksActor,input:{
  accountId:string; target:ExportTarget; externalName:string; externalTaxRate?:string;
}) {
  allow(actor,"OWNER");
  const name=safeText(input.externalName,160);
  if (input.externalTaxRate && input.target!=="XERO_JOURNAL_CSV")
    throw new BooksInputError("Only Xero export mappings accept a tax rate.");
  return prisma.$transaction(async tx=>{
    const account=await tx.ledgerAccount.findUnique({where:{id:input.accountId}});
    if(!account)throw new BooksInputError("Account not found.");
    const current=await tx.accountExportMapping.findUnique({where:{ledgerAccountId_target:{
      ledgerAccountId:input.accountId,target:input.target}}});
    await tx.accountExportMapping.upsert({where:{ledgerAccountId_target:{ledgerAccountId:input.accountId,target:input.target}},
      create:{ledgerAccountId:input.accountId,target:input.target,externalName:name,
        externalTaxRate:input.target==="XERO_JOURNAL_CSV" ? input.externalTaxRate??"Tax Exempt":null},
      update:{externalName:name,externalTaxRate:input.target==="XERO_JOURNAL_CSV"?input.externalTaxRate??"Tax Exempt":null}});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.mapping.update",entityType:"LedgerAccount",
      entityId:input.accountId,oldValue:current?{name:current.externalName}:{},newValue:{target:input.target,name}}});
  });
}
/** Journal browser only reveals internal ledger records to owner/admin; never full customer PII. */
export async function getBooksWorkspace(actor:BooksActor, options?:{month?:string;page?:number}) {
  allow(actor,"OWNER","ADMIN");
  const month=options?.month?periodKey(options.month):undefined;
  const page=Math.min(200,Math.max(1,Math.floor(options?.page??1)));
  const [settings,accounts,entries,periods,total,issues]=await Promise.all([
    prisma.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}}),
    prisma.ledgerAccount.findMany({orderBy:[{sortOrder:"asc"},{name:"asc"}],
      include:{mappings:true}}),
    prisma.journalEntry.findMany({where:month?{periodKey:month}:{},
      include:{lines:{include:{ledgerAccount:{select:{name:true,type:true}}}}},
      orderBy:[{entryDate:"desc"},{entryNumber:"desc"}],skip:(page-1)*30,take:30}),
    prisma.accountingPeriod.findMany({orderBy:{periodKey:"desc"},take:36}),
    prisma.journalEntry.count({where:month?{periodKey:month}:{}}),
    prisma.systemIssue.findMany({where:{kind:{in:["BOOKS_POSTING_FAILURE","BOOKS_STRIPE_CLEARING_DIFFERENCE"]},status:"OPEN"},
      orderBy:{lastSeenAt:"desc"},take:30,select:{id:true,summary:true,detail:true,lastSeenAt:true,occurrences:true}}),
  ]);
  const balances=await prisma.journalLine.groupBy({
    by:["ledgerAccountId"],_sum:{debitCents:true,creditCents:true},
  });
  return {settings,accounts,entries,periods,balances,issues,total,page,month};
}

export async function closeAccountingMonth(actor:BooksActor, key:string) {
  allow(actor,"OWNER");periodKey(key);
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"books-period:"+key}))) AS guard`;
    const settings=await tx.businessSettings.findUnique({where:{id:"singleton"}});
    if(!settings?.booksStartDate)throw new BooksInputError("Initialize your books first.");
    if(key>businessDateKey(new Date()).slice(0,7))throw new BooksInputError("Cannot close a future month.");
    // No closing without a stored immutable export/review of the month.
    const entries=await tx.journalEntry.findMany({where:{periodKey:key},select:{id:true}});
    const exported=await tx.exportBatchEntry.findMany({where:{journalEntryId:{in:entries.map(x=>x.id)}},
      select:{journalEntryId:true}});
    if(entries.length && new Set(exported.map(x=>x.journalEntryId)).size !== entries.length)
      throw new BooksInputError("Export every entry in this month before closing it.");
    const was=await tx.accountingPeriod.findUnique({where:{periodKey:key}});
    if(was?.status==="CLOSED")return;
    await tx.accountingPeriod.upsert({where:{periodKey:key},
      create:{periodKey:key,status:"CLOSED",closedAt:new Date(),closedByUserId:actor.id},
      update:{status:"CLOSED",closedAt:new Date(),closedByUserId:actor.id,reopenedReason:null}});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.period.close",entityType:"AccountingPeriod",
      entityId:key,oldValue:{status:was?.status??"OPEN"},newValue:{status:"CLOSED",exported:entries.length}}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
export async function reopenAccountingMonth(actor:BooksActor,key:string,reason:string) {
  allow(actor,"OWNER");periodKey(key);const why=safeText(reason,300);
  return prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${"books-period:"+key}))) AS guard`;
    const period=await tx.accountingPeriod.findUnique({where:{periodKey:key}});
    if(period?.status!=="CLOSED")throw new BooksInputError("This month is already open.");
    await tx.accountingPeriod.update({where:{periodKey:key},
      data:{status:"OPEN",closedAt:null,closedByUserId:null,reopenedReason:why}});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.period.reopen",entityType:"AccountingPeriod",
      entityId:key,oldValue:{status:"CLOSED"},newValue:{status:"OPEN",reason:why}}});
  },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable});
}
/** K-2B's immutable review export; K-5 adds provider-specific journal import formats. */
export async function exportMonthReview(actor:BooksActor,key:string) {
  allow(actor,"OWNER","ADMIN");periodKey(key);
  return prisma.$transaction(async tx=>{
    const entries=await tx.journalEntry.findMany({where:{periodKey:key},include:{lines:{include:{ledgerAccount:true}}},orderBy:{entryNumber:"asc"}});
    const cleanCell=(value:string)=>'"'+(/^[=+@\-\t\r]/.test(value)?"'"+value:value).replaceAll('"','""')+'"';
    const csv=['Date,Entry,Source,Account,Debit cents,Credit cents,Memo',
      ...entries.flatMap(row=>row.lines.map(line=>[
        row.entryDate.toISOString().slice(0,10),String(row.entryNumber),row.sourceType,
        line.ledgerAccount.name,String(line.debitCents),String(line.creditCents),row.memo,
      ].map(cleanCell).join(',')))].join('\n')+'\n';
    const fingerprint=createHash("sha256").update(csv).digest("hex");
    const batch=await tx.exportBatch.create({data:{
      target:"GENERIC_JOURNAL_CSV",mode:"DETAIL",periodFrom:businessDateFromKey(key+"-01")!,
      periodTo:businessDateFromKey(key+"-"+String(new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5)),0)).getUTCDate()).padStart(2,"0"))!,fileName:"books-review-"+key+".csv",
      content:csv,contentSha256:fingerprint,entryCount:entries.length,createdByUserId:actor.id,
      entries:{create:entries.map(row=>({journalEntryId:row.id}))},
    }});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.export.review",entityType:"ExportBatch",
      entityId:batch.id,newValue:{month:key,entries:entries.length,sha256:fingerprint}}});
    return {batchId:batch.id,csv,fileName:batch.fileName};
  });
}
