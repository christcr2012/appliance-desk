import {randomUUID} from "node:crypto";
import {beforeAll,afterAll,describe,expect,it} from "vitest";
import {prisma} from "@/lib/prisma";
import {profitAndLoss,balanceSnapshot,appliancePayback} from "@/domains/books/reports";
import {businessDateFromKey} from "@/lib/business-date";

const u=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&u.pathname==="/appliance_desk_test"&&["localhost","127.0.0.1"].includes(u.hostname);
const tag=randomUUID().slice(0,12),owner="k7-owner-"+tag,staff="k7-staff-"+tag,customerUser="k7-cu-"+tag;
const customerId="k7-customer-"+tag,invoiceId="k7-invoice-"+tag,receiptId="k7-receipt-"+tag,paymentId="k7-payment-"+tag;
const incomeId="k7-income-"+tag;const day=(s:string)=>businessDateFromKey(s)!;
const journalIds:string[]=[];
let oldStart:Date|null=null;
describe.skipIf(!enabled)("K-7 reports read immutable money and refuse other roles on real disposable Postgres",()=>{
 beforeAll(async()=>{
  const settings=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  oldStart=settings.booksStartDate;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:day("2026-01-01")}});
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:staff,email:staff+"@example.test",role:"STAFF"},
   {id:customerUser,email:customerUser+"@example.test",role:"CUSTOMER"},
  ]});
  await prisma.customer.create({data:{id:customerId,userId:customerUser,
   referralCode:"K7"+tag.toUpperCase()}});
  await prisma.ledgerAccount.create({data:{id:incomeId,name:"K7 source income "+tag,type:"INCOME",description:"Disposable trial rent"}});
  await prisma.invoice.create({data:{id:invoiceId,customerId,status:"OPEN",
   amountDueCents:11000,subtotalCents:10000,taxCents:1000,issuedAt:day("2026-03-15")}});
  await prisma.receipt.create({data:{id:receiptId,customerId,source:"MANUAL",method:"CASH",
   amountCents:11000,receivedOn:day("2026-04-02")}});
  await prisma.payment.create({data:{id:paymentId,invoiceId,receiptId,status:"SUCCEEDED",
   amountCents:11000,method:"CASH",createdAt:day("2026-04-02")}});
  const rows=await prisma.ledgerAccount.findMany({where:{
   systemRole:{in:["RECEIVABLES","SALES_TAX_UNASSIGNED","BANK","UNAPPLIED_RECEIPTS"]}},
   select:{id:true,systemRole:true}});
  const role=(name:string)=>{const r=rows.find(x=>x.systemRole===name);if(!r)throw Error("Missing chart "+name);return r.id;};
  const add=async(sourceType:"INVOICE"|"RECEIPT"|"PAYMENT",sourceId:string,eventKind:string,
   key:string,lines:{accountId:string;debit?:number;credit?:number}[])=>{
   const entry=await prisma.journalEntry.create({data:{
    sourceType,sourceId,eventKind,entryDate:day(key),periodKey:key.slice(0,7),
    memo:"K7 disposable money evidence",lines:{create:lines.map(l=>({
     ledgerAccountId:l.accountId,debitCents:l.debit??0,creditCents:l.credit??0,
    }))},
   }});
   journalIds.push(entry.id);
  };
  await add("INVOICE",invoiceId,"INVOICE_RECOGNIZED","2026-03-15",[
   {accountId:role("RECEIVABLES"),debit:11000},{accountId:incomeId,credit:10000},
   {accountId:role("SALES_TAX_UNASSIGNED"),credit:1000},
  ]);
  await add("RECEIPT",receiptId,"RECEIPT_RECEIVED","2026-04-02",[
   {accountId:role("BANK"),debit:11000},{accountId:role("UNAPPLIED_RECEIPTS"),credit:11000},
  ]);
  await add("PAYMENT",paymentId,"PAYMENT_APPLIED","2026-04-02",[
   {accountId:role("UNAPPLIED_RECEIPTS"),debit:11000},{accountId:role("RECEIVABLES"),credit:11000},
  ]);
 });
 afterAll(async()=>{
  await prisma.journalLine.deleteMany({where:{entryId:{in:journalIds}}});
  await prisma.journalEntry.deleteMany({where:{id:{in:journalIds}}});
  await prisma.payment.deleteMany({where:{id:paymentId}});
  await prisma.receipt.deleteMany({where:{id:receiptId}});
  await prisma.invoice.deleteMany({where:{id:invoiceId}});
  await prisma.ledgerAccount.deleteMany({where:{id:incomeId}});
  await prisma.customer.deleteMany({where:{id:customerId}});
  await prisma.user.deleteMany({where:{id:{in:[owner,staff,customerUser]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:oldStart}});
 });
 it("prevents staff from any P&L, balance or appliance analytics read",async()=>{
  await expect(profitAndLoss(staff,{from:"2026-03-01",to:"2026-03-31",basis:"ACCRUAL"})).rejects.toThrow(/access/);
  await expect(balanceSnapshot(staff,"2026-04-30")).rejects.toThrow(/access/);
  await expect(appliancePayback(staff)).rejects.toThrow(/access/);
 });
 it("excludes sales-tax pass-through and dates accrual income to the journal",async()=>{
  const x=await profitAndLoss(owner,{from:"2026-03-01",to:"2026-03-31",basis:"ACCRUAL"});
  expect(x.summary.rows.find(z=>z.accountId===incomeId)?.amountCents).toBe(10000);
  expect(x.summary.rows.some(z=>z.name==="SALES_TAX_UNASSIGNED")).toBe(false);
  const cash=await profitAndLoss(owner,{from:"2026-03-01",to:"2026-03-31",basis:"CASH"});
  expect(cash.summary.rows.find(z=>z.accountId===incomeId)).toBeUndefined();
 });
 it("cash basis recognizes only receipt-backed applied invoice cash, net of taxes",async()=>{
  const p=await profitAndLoss(owner,{from:"2026-04-01",to:"2026-04-30",basis:"CASH"});
  expect(p.needsReview).toEqual([]);
  expect(p.summary.rows.find(z=>z.accountId===incomeId)?.amountCents).toBe(10000);
  const accrual=await profitAndLoss(owner,{from:"2026-04-01",to:"2026-04-30",basis:"ACCRUAL"});
  expect(accrual.summary.rows.find(z=>z.accountId===incomeId)).toBeUndefined();
 });
 it("refuses a balance snapshot before Books opening instead of reporting zero assets",async()=>{
  await expect(balanceSnapshot(owner,"2025-12-31")).rejects.toThrow(/opening date/);
 });
 it("allocates real completed maintenance job cost across two machines once",async()=>{
  const applianceType="k7-job-type-"+tag,first="k7-job-a-"+tag,second="k7-job-b-"+tag,job="k7-job-"+tag;
  await prisma.applianceType.create({data:{id:applianceType,name:"K7 repair type "+tag,slug:"k7-job-"+tag}});
  await prisma.appliance.createMany({data:[
   {id:first,assetNumber:"K7-JOBA-"+tag,applianceTypeId:applianceType,acquisitionCostCents:4000},
   {id:second,assetNumber:"K7-JOBB-"+tag,applianceTypeId:applianceType,acquisitionCostCents:4000},
  ]});
  await prisma.job.create({data:{id:job,type:"MAINTENANCE_VISIT",status:"COMPLETED",
   completedAt:day("2026-04-15"),partsCostCents:1001,laborCostCents:200}});
  await prisma.jobAppliance.createMany({data:[
   {jobId:job,applianceId:first},{jobId:job,applianceId:second},
  ]});
  try{
   const report=await appliancePayback(owner,day("2026-05-01"));
   const numbers=[first,second].map(id=>report.rows.find(row=>row.applianceId===id)?.repairCostCents);
   expect(numbers.every(n=>n!==undefined)).toBe(true);
   expect(numbers.reduce<number>((sum,n)=>sum+(n??0),0)).toBe(1201);
   expect([...numbers].sort((a,b)=>(a??0)-(b??0))).toEqual([600,601]);
  }finally{
   await prisma.jobAppliance.deleteMany({where:{jobId:job}});
   await prisma.job.delete({where:{id:job}});
   await prisma.appliance.deleteMany({where:{id:{in:[first,second]}}});
   await prisma.applianceType.delete({where:{id:applianceType}});
  }
 });
 it("as-of position remains precisely balanced without taxing business revenue twice",async()=>{
  const b=await balanceSnapshot(owner,"2026-04-30");
  expect(b.equationDifferenceCents).toBe(0);
  expect(b.rows.find(x=>x.accountId===incomeId)?.balanceCents).toBe(10000);
 });
 it("rejects invalid dates without any financial source writes",async()=>{
  await expect(profitAndLoss(owner,{from:"2026-02-31",to:"2026-03-31",basis:"ACCRUAL"})).rejects.toThrow(/actual|real|calendar/i);
  await expect(profitAndLoss(owner,{from:"2026-04-30",to:"2026-04-01",basis:"ACCRUAL"})).rejects.toThrow(/chronological/);
  expect(await prisma.journalEntry.count({where:{id:{in:journalIds}}})).toBe(3);
 });
});
