import { createHash } from "node:crypto";
import { Prisma, type ExportTarget, type LedgerAccountType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { openingBalance, balancedPlan, type PostingLine } from "./posting-rules";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { writeJournal } from "./post";

export type BooksActor = { id: string; role: "OWNER" | "ADMIN" | "STAFF" | "CUSTOMER" | "ACCOUNTANT" };
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
export type OpeningBalanceValues={bankCents:number;stripeCents:number;cardCents:number};
const OPENING_ROLES=["BANK","STRIPE_CLEARING","CARD"] as const;
async function openingTotals(tx:Prisma.TransactionClient,startDate:Date){
  const key=businessDateKey(startDate);
  const rows=await tx.journalEntry.findMany({where:{
   sourceType:"OPENING",sourceId:key,OR:[
    {eventKind:"OPENING_BALANCE"},{eventKind:{startsWith:"OPENING_CORRECTED_"}},
   ],
  },select:{eventKind:true,lines:{select:{
   debitCents:true,creditCents:true,ledgerAccount:{select:{systemRole:true}},
  }}}});
  const net=new Map<string,number>();
  for(const row of rows)for(const line of row.lines){
   const role=line.ledgerAccount.systemRole;
   if(role&&OPENING_ROLES.some(x=>x===role))
    net.set(role,(net.get(role)??0)+line.debitCents-line.creditCents);
  }
  return {bankCents:net.get("BANK")??0,stripeCents:net.get("STRIPE_CLEARING")??0,
   cardCents:-(net.get("CARD")??0),
   corrections:rows.filter(row=>row.eventKind.startsWith("OPENING_CORRECTED_")).length};
}
export async function currentOpeningBalances(actor:BooksActor){
 allow(actor,"OWNER","ADMIN");
 const settings=await prisma.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}});
 if(!settings?.booksStartDate)throw new BooksInputError("Start your books before correcting starting balances.");
 const totals=await prisma.$transaction(tx=>openingTotals(tx,settings.booksStartDate!));
 return {startDate:settings.booksStartDate,...totals};
}
/** The real owner's corrected numbers are a new, balanced journal; original entries never change. */
export async function correctOpeningBalances(actor:BooksActor,input:OpeningBalanceValues & {reason:string}){
 allow(actor,"OWNER");
 const bank=safeCents(input.bankCents),stripe=safeCents(input.stripeCents),card=safeCents(input.cardCents);
 const reason=safeText(input.reason,300);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,actor.id,["OWNER"]);
  await tx.$queryRaw`SELECT "id" FROM "BooksPostingRevision" WHERE "id" = ${"singleton"} FOR UPDATE`;
  const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},select:{booksStartDate:true}});
  if(!settings?.booksStartDate)throw new BooksInputError("Start your books before correcting balances.");
  const current=await openingTotals(tx,settings.booksStartDate);
  const ds=stripe-current.stripeCents,db=bank-current.bankCents,dc=card-current.cardCents;
  if(!ds&&!db&&!dc)throw new BooksInputError("These balances already match. Nothing was changed.");
  const lines:PostingLine[]=[];
  const signed=(role:string,diff:number)=>{
   if(diff>0)lines.push({role,debitCents:diff,creditCents:0});
   else if(diff<0)lines.push({role,debitCents:0,creditCents:-diff});
  };
  signed("STRIPE_CLEARING",ds);
  signed("BANK",db);
  signed("CARD",-dc);
  signed("OWNER_CONTRIBUTIONS",-(ds+db-dc));
  const plan=balancedPlan(settings.booksStartDate,"Starting balances corrected: "+reason,lines);
  if(!plan)throw new BooksInputError("No change to record.");
  const n=current.corrections+1;
  const eventKind="OPENING_CORRECTED_"+n;
  if(!await writeJournal(tx,"OPENING",businessDateKey(settings.booksStartDate),eventKind,plan))
   throw new BooksInputError("Starting balances were changed in another request; refresh and try again.");
  await tx.auditLog.create({data:{userId:actor.id,action:"books.opening.correct",
   entityType:"BusinessSettings",entityId:"singleton",
   oldValue:{bankCents:current.bankCents,stripeCents:current.stripeCents,cardCents:current.cardCents},
   newValue:{bankCents:bank,stripeCents:stripe,cardCents:card,reason,eventKind}}});
  return {eventKind};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
/** A recommendation, never an owner decision; the owner can change the date. */
export async function suggestedBooksStartDate(now=new Date()){
 const [appliance,invoice,expense]=await Promise.all([
  prisma.appliance.findFirst({where:{purchaseDate:{not:null}},orderBy:{purchaseDate:"asc"},select:{purchaseDate:true}}),
  prisma.invoice.findFirst({orderBy:{createdAt:"asc"},select:{createdAt:true}}),
  prisma.expense.findFirst({orderBy:{spentOn:"asc"},select:{spentOn:true}}),
 ]);
 return businessDateKey(new Date(Math.min(now.getTime(),
  ...[appliance?.purchaseDate,invoice?.createdAt,expense?.spentOn].filter((d):d is Date=>d instanceof Date)
   .map(d=>d.getTime()))));
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
  // ACCT-1: account mapping is one of the accountant's allowed changes.
  allow(actor,"OWNER","ACCOUNTANT");
  const name=safeText(input.externalName,160);
  const taxName=input.externalTaxRate?.trim()||"Tax Exempt";
  if(taxName.length>120)throw new BooksInputError("Xero tax rate name is too long.");
  if (input.externalTaxRate?.trim() && input.target!=="XERO_JOURNAL_CSV")
    throw new BooksInputError("Only Xero export mappings accept a tax rate.");
  return prisma.$transaction(async tx=>{
    const account=await tx.ledgerAccount.findUnique({where:{id:input.accountId}});
    if(!account)throw new BooksInputError("Account not found.");
    const current=await tx.accountExportMapping.findUnique({where:{ledgerAccountId_target:{
      ledgerAccountId:input.accountId,target:input.target}}});
    await tx.accountExportMapping.upsert({where:{ledgerAccountId_target:{ledgerAccountId:input.accountId,target:input.target}},
      create:{ledgerAccountId:input.accountId,target:input.target,externalName:name,
        externalTaxRate:input.target==="XERO_JOURNAL_CSV" ? taxName:null},
      update:{externalName:name,externalTaxRate:input.target==="XERO_JOURNAL_CSV"?taxName:null}});
    await tx.auditLog.create({data:{userId:actor.id,action:"books.mapping.update",entityType:"LedgerAccount",
      entityId:input.accountId,oldValue:current?{name:current.externalName}:{},newValue:{target:input.target,name}}});
  });
}
/** Journal browser only reveals internal ledger records to owner/admin (and the accountant, ACCT-1); never full customer PII. */
export async function getBooksWorkspace(actor:BooksActor, options?:{month?:string;page?:number}) {
  allow(actor,"OWNER","ADMIN","ACCOUNTANT");
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
  // ACCT-1: closing a month is one of the accountant's allowed changes.
  allow(actor,"OWNER","ACCOUNTANT");periodKey(key);
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
  // ACCT-1: reopening a month is one of the accountant's allowed changes.
  allow(actor,"OWNER","ACCOUNTANT");periodKey(key);const why=safeText(reason,300);
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
async function exportMonthReviewInTx(tx:Prisma.TransactionClient,actor:BooksActor,key:string){

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
}
export async function exportMonthReview(actor:BooksActor,key:string){
 allow(actor,"OWNER","ADMIN","ACCOUNTANT");periodKey(key);
 return prisma.$transaction(tx=>exportMonthReviewInTx(tx,actor,key));
}

/** Month lock and its audit/export are one transaction, not separate button clicks. */
export async function closeAccountingMonthWithReview(actor:BooksActor,key:string,
 notes:{expenses?:string;payments?:string}={}){
 // ACCT-1: the reviewed-month lock is the "Reviewed by accountant" mark when an accountant makes it.
 allow(actor,"OWNER","ACCOUNTANT");periodKey(key);
 const clean=(value:string|undefined)=>{
  const text=(value??"").trim();
  if(text.length>300)throw new BooksInputError("Review explanation must be 300 characters or fewer.");
  return text;
 };
 const expenses=clean(notes.expenses),payments=clean(notes.payments);
 return prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,actor.id,["OWNER","ACCOUNTANT"]);
  await tx.$queryRaw`SELECT "revision" FROM "BooksPostingRevision"
   WHERE "id"=${"singleton"} FOR UPDATE`;
  await tx.$queryRaw`SELECT 1 AS locked FROM
   (SELECT pg_advisory_xact_lock(hashtext(${"books-period:"+key}))) AS guard`;
  const settings=await tx.businessSettings.findUnique({where:{id:"singleton"},
   select:{booksStartDate:true}});
  if(!settings?.booksStartDate)throw new BooksInputError("Start your books before locking.");
  const was=await tx.accountingPeriod.findUnique({where:{periodKey:key}});
  if(was?.status==="CLOSED")return {alreadyClosed:true,exported:false};
  // Every Books evidence read that authorizes this close belongs to this
  // Serializable snapshot, after the ledger and month locks are acquired.
  const {monthReview}=await import("./month-review");
  const review=await monthReview(actor,key,new Date(),tx);
  if(!review.checks.sources.ok||!review.checks.equipment.ok)
   throw new BooksInputError("First finish the missing source journals and equipment depreciation.");
  if(!review.checks.costs.ok&&!expenses)
   throw new BooksInputError("Explain why the unverified expenses are being locked.");
  if(!review.checks.payments.ok&&!payments)
   throw new BooksInputError("Explain why unresolved payment evidence is being locked.");
  const entries=await tx.journalEntry.findMany({where:{periodKey:key},select:{id:true}});
  const existing=entries.length?await tx.exportBatchEntry.findMany({
   where:{journalEntryId:{in:entries.map(x=>x.id)}},select:{journalEntryId:true},
  }):[];
  const exported=entries.length>new Set(existing.map(x=>x.journalEntryId)).size;
  if(exported)await exportMonthReviewInTx(tx,actor,key);
  const reviewNotes=[
   ...(!review.checks.costs.ok?[{check:"expenses",reason:expenses,
    byUserId:actor.id,at:new Date().toISOString()}]:[]),
   ...(!review.checks.payments.ok?[{check:"payments",reason:payments,
    byUserId:actor.id,at:new Date().toISOString()}]:[]),
  ];
  await tx.accountingPeriod.upsert({where:{periodKey:key},
   create:{periodKey:key,status:"CLOSED",closedAt:new Date(),closedByUserId:actor.id,
    reviewNotes},
   update:{status:"CLOSED",closedAt:new Date(),closedByUserId:actor.id,
    reopenedReason:null,reviewNotes},
  });
  await tx.auditLog.create({data:{userId:actor.id,action:"books.period.close-review",
   entityType:"AccountingPeriod",entityId:key,
   oldValue:{status:was?.status??"OPEN"},
   newValue:{status:"CLOSED",sourceChecksPassed:true,equipmentCheckPassed:true,
    expensesOverridden:!!(!review.checks.costs.ok&&expenses),
    paymentsOverridden:!!(!review.checks.payments.ok&&payments),
    entryCount:entries.length,createdReviewExport:exported}}});
  return {alreadyClosed:false,exported};
 },{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});
}
