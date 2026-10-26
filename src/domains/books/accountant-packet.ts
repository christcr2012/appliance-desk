import { prisma } from "@/lib/prisma";
import { sendEmail, type EmailOutcome } from "@/lib/email";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateFromKey, businessDateKey } from "@/lib/business-date";
import { lastBusinessDay, lastCompletedMonth, monthKey, nextMonth } from "./depreciation";
import { profitAndLoss } from "./reports";
import type { BooksActor } from "./management";

const csv=(value:string|number)=>{
 const text=String(value);
 const escaped=/^[=+@\-\t\r]/.test(text)?"'"+text:text;
 return '"'+escaped.replaceAll('"','""')+'"';
};
export type MonthPacket={journalCsv:string;profitCsv:string;month:string};
/** Read-only accountant files. No private contacts are read and no export is created by a GET. */
export async function buildMonthPacket(actor:BooksActor,key:string):Promise<MonthPacket>{
 monthKey(key);
 if(key>lastCompletedMonth())throw new Error("Choose a completed month.");
 await prisma.$transaction(tx=>assertActiveTeamActor(tx,actor.id,["OWNER","ADMIN"]));
 const first=businessDateFromKey(key+"-01")!,end=businessDateFromKey(nextMonth(key)+"-01")!;
 const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{booksStartDate:true}});
 if(!settings.booksStartDate)throw new Error("Start your books before exporting a report.");
 if(key<businessDateKey(settings.booksStartDate).slice(0,7))throw new Error("This month predates your Books start date.");
 const start=settings.booksStartDate>first?settings.booksStartDate:first;
 const last=lastBusinessDay(key);
 const entries=await prisma.journalEntry.findMany({where:{entryDate:{gte:start,lt:end}},
  orderBy:[{entryDate:"asc"},{entryNumber:"asc"}],
  include:{lines:{include:{ledgerAccount:{select:{name:true}}}}},take:10001});
 if(entries.length>10000)throw new Error("Month export is too large; ask an accountant to split the data.");
 const journalCsv=[
  ["Date","Entry","Source","Account","Debit cents","Credit cents","Memo"].map(csv).join(","),
  ...entries.flatMap(e=>e.lines.map(line=>
   [businessDateKey(e.entryDate),e.entryNumber,e.sourceType,
    line.ledgerAccount.name,line.debitCents,line.creditCents,e.memo].map(csv).join(","))),
 ].join("\n")+"\n";
 const report=await profitAndLoss(actor.id,{from:businessDateKey(start),to:businessDateKey(last),basis:"ACCRUAL"});
 const profitCsv=[
  ["Month","Account","Kind","Amount cents"].map(csv).join(","),
  ...report.summary.rows.map(row=>[key,row.name,row.type,row.amountCents].map(csv).join(",")),
  [key,"Total income","INCOME",report.summary.incomeCents].map(csv).join(","),
  [key,"Income reductions","CONTRA_INCOME",report.summary.reductionsCents].map(csv).join(","),
  [key,"Total expenses","EXPENSE",report.summary.expenseCents].map(csv).join(","),
  [key,"Net profit","PROFIT",report.summary.netProfitCents].map(csv).join(","),
 ].join("\n")+"\n";
 return {month:key,journalCsv,profitCsv};
}
export async function saveAccountantReviewSettings(actor:BooksActor,input:{
 accountantEmail:string;reminderDay:number;
}){
 if(actor.role!=="OWNER")throw new Error("Only the owner can update accountant settings.");
 const email=input.accountantEmail.trim().toLowerCase();
 if(email&&(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>200))
  throw new Error("Enter a valid accountant email address or leave it blank.");
 if(!Number.isSafeInteger(input.reminderDay)||input.reminderDay<1||input.reminderDay>28)
  throw new Error("Choose a reminder day from 1 to 28.");
 await prisma.$transaction(async tx=>{
  await assertActiveTeamActor(tx,actor.id,["OWNER"]);
  const was=await tx.businessSettings.findUnique({where:{id:"singleton"},
   select:{accountantEmail:true,booksReviewReminderDay:true}});
  await tx.businessSettings.update({where:{id:"singleton"},data:{
   accountantEmail:email||null,booksReviewReminderDay:input.reminderDay,
  }});
  await tx.auditLog.create({data:{userId:actor.id,action:"books.review.settings",
   entityType:"BusinessSettings",entityId:"singleton",
   oldValue:{accountantEmailConfigured:!!was?.accountantEmail,reminderDay:was?.booksReviewReminderDay??15},
   newValue:{accountantEmailConfigured:!!email,reminderDay:input.reminderDay}}});
 });
}
/** Called ONLY by an explicit owner's Send action. Never sends automatically. */
export async function sendMonthToAccountant(actor:BooksActor,key:string):Promise<{
 outcome:EmailOutcome;message:string;
}>{
 if(actor.role!=="OWNER")throw new Error("Only the owner may send files to the accountant.");
 monthKey(key);
 await prisma.$transaction(tx=>assertActiveTeamActor(tx,actor.id,["OWNER"]));
 const [settings,period]=await Promise.all([
  prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{accountantEmail:true}}),
  prisma.accountingPeriod.findUnique({where:{periodKey:key},select:{accountantSentAt:true}}),
 ]);
 if(period?.accountantSentAt)return {outcome:"SENT",message:"This month's package was already accepted for your accountant."};
 const to=settings.accountantEmail?.trim();
 if(!to)throw new Error("Save your accountant's email address before sending.");
 const packet=await buildMonthPacket(actor,key);
 const result=await sendEmail({
  to,subject:"Robinson Appliance Rentals — "+key+" month Books package",
  text:"Here are the accounting journal and profit report for "+key+
   ". Please independently reconcile these records before filing or importing.",
  attachments:[
   {filename:"books-journal-"+key+".csv",content:Buffer.from(packet.journalCsv,"utf8")},
   {filename:"books-profit-"+key+".csv",content:Buffer.from(packet.profitCsv,"utf8")},
  ],
  idempotencyKey:"books-accountant-"+key,
 });
 const outcome=result.outcome??(result.sent?"SENT":"UNKNOWN");
 if(outcome==="SENT"&&result.sent){
  await prisma.$transaction(async tx=>{
   await assertActiveTeamActor(tx,actor.id,["OWNER"]);
   const saved=await tx.accountingPeriod.findUnique({where:{periodKey:key},
    select:{accountantSentAt:true}});
   if(!saved?.accountantSentAt)await tx.accountingPeriod.upsert({where:{periodKey:key},
    create:{periodKey:key,accountantSentAt:new Date()},
    update:{accountantSentAt:new Date()},
   });
   await tx.auditLog.create({data:{userId:actor.id,action:"books.review.accountant-sent",
    entityType:"AccountingPeriod",entityId:key,newValue:{outcome:"SENT",providerMessageId:result.providerMessageId??null}}});
  });
  return {outcome:"SENT",message:"The email service accepted the two accounting files."};
 }
 if(outcome==="UNKNOWN")return {outcome,message:"We couldn't tell whether it was sent. Check with your accountant before trying again."};
 if(outcome==="REJECTED")return {outcome,message:"The email service refused it. Nothing was sent; try again later."};
 return {outcome:"NOT_ATTEMPTED",message:"Email isn't set up on this app yet. Download the package instead."};
}
