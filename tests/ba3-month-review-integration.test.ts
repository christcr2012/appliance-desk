import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { openingBalance } from "@/domains/books/posting-rules";
import { writeJournal } from "@/domains/books/post";
import { monthReview } from "@/domains/books/month-review";
import { closeAccountingMonthWithReview, type BooksActor } from "@/domains/books/management";
import { listBooksMonthReviewAttention } from "@/domains/exceptions/books-attention";

const target=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(target.hostname)
 &&target.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,9),key="2020-01";
const owner:BooksActor={id:"ba3-owner-"+tag,role:"OWNER"};
const admin:BooksActor={id:"ba3-admin-"+tag,role:"ADMIN"};
const dates=(s:string)=>businessDateFromKey(s)!;
const where={sourceType:"OPENING" as const,sourceId:"2020-01-01"};

describe.skipIf(!enabled)("BA-3 month review and immutable locking on isolated PostgreSQL",()=>{
 let original:Date|null=null;
 let oldPeriod:null|{status:"OPEN"|"CLOSED";closedAt:Date|null;
  closedByUserId:string|null;reopenedReason:string|null;reviewNotes:unknown;accountantSentAt:Date|null}=null;
 let expenseId:string|null=null;
 beforeAll(async()=>{
  const [settings,existing]=await Promise.all([
   prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"},select:{booksStartDate:true}}),
   prisma.accountingPeriod.findUnique({where:{periodKey:key},select:{
    status:true,closedAt:true,closedByUserId:true,reopenedReason:true,reviewNotes:true,accountantSentAt:true,
   }}),
  ]);
  original=settings.booksStartDate;oldPeriod=existing;
  await prisma.user.createMany({data:[
   {id:owner.id,email:owner.id+"@example.test",role:"OWNER"},
   {id:admin.id,email:admin.id+"@example.test",role:"ADMIN"},
  ]});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:dates("2020-01-01")}});
  const plan=openingBalance({date:dates("2020-01-01"),
   bankCents:25000,stripeCents:0,cardCents:0});
  expect(plan).not.toBeNull();
  await prisma.$transaction(tx=>writeJournal(tx,"OPENING","2020-01-01","OPENING_BALANCE",plan!));
 });
 afterAll(async()=>{
  await prisma.accountingPeriod.updateMany({where:{periodKey:key},data:{status:"OPEN",
   closedAt:null,closedByUserId:null}});
  const batches=await prisma.exportBatch.findMany({where:{
   fileName:"books-review-"+key+".csv",createdByUserId:owner.id,
  },select:{id:true}});
  await prisma.exportBatchEntry.deleteMany({where:{batchId:{in:batches.map(x=>x.id)}}});
  await prisma.exportBatch.deleteMany({where:{id:{in:batches.map(x=>x.id)}}});
  await prisma.journalLine.deleteMany({where:{entry:where}});
  await prisma.journalEntry.deleteMany({where});
  if(expenseId)await prisma.expense.deleteMany({where:{id:expenseId}});
  await prisma.auditLog.deleteMany({where:{userId:{in:[owner.id,admin.id]}}});
  if(oldPeriod)await prisma.accountingPeriod.update({where:{periodKey:key},data:{
   status:oldPeriod.status,closedAt:oldPeriod.closedAt,
   closedByUserId:oldPeriod.closedByUserId,reopenedReason:oldPeriod.reopenedReason,
   reviewNotes:oldPeriod.reviewNotes as never,accountantSentAt:oldPeriod.accountantSentAt,
  }});
  else await prisma.accountingPeriod.deleteMany({where:{periodKey:key}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{booksStartDate:original}});
  await prisma.user.deleteMany({where:{id:{in:[owner.id,admin.id]}}});
 });
 it("shows an ended unlocked month and four grounded checks to owner and admin",async()=>{
  const review=await monthReview(owner,key);
  expect(review.status).toBe("OPEN");
  expect(review.checks.sources.ok).toBe(true);
  expect(review.checks.equipment.ok).toBe(true);
  expect(review.profit.netProfitCents).toBe(0);
  expect((await monthReview(admin,key)).checks.sources.ok).toBe(true);
  expect((await listBooksMonthReviewAttention()).some(x=>x.href==="/desk/books/months/"+key)).toBe(true);
 });
 it("rejects admin locking and an expense override without a stated reason",async()=>{
  await expect(closeAccountingMonthWithReview(admin,key)).rejects.toThrow(/OWNER/);
  const [category,payment]=await Promise.all([
   prisma.expenseCategory.findFirstOrThrow(),
   prisma.ledgerAccount.findFirstOrThrow({where:{OR:[{isPaymentSource:true},
    {systemRole:"OWNER_CONTRIBUTIONS"}]}}),
  ]);
  const row=await prisma.expense.create({data:{
   status:"DRAFT",spentOn:dates("2020-01-11"),amountCents:1000,vendorTaxCents:0,
   vendorName:"Synthetic review cost",categoryId:category.id,
   paidFromAccountId:payment.id,submittedByUserId:owner.id,
  }});
  expenseId=row.id;
  expect((await monthReview(owner,key)).checks.costs.ok).toBe(false);
  await expect(closeAccountingMonthWithReview(owner,key)).rejects.toThrow(/Explain/);
 });
 it("exports the unchanged journal and locks with the typed reason atomically",async()=>{
  const result=await closeAccountingMonthWithReview(owner,key,{
   expenses:"Synthetic missing receipt reviewed, follow-up remains on the accountant packet.",
   payments:"Bank source remains outside this historical accounting month.",
  });
  expect(result).toMatchObject({alreadyClosed:false,exported:true});
  const period=await prisma.accountingPeriod.findUniqueOrThrow({where:{periodKey:key}});
  expect(period.status).toBe("CLOSED");
  expect(JSON.stringify(period.reviewNotes)).toContain("Synthetic missing receipt reviewed");
  expect(await prisma.exportBatchEntry.count({where:{journalEntry:{...where}}})).toBeGreaterThan(0);
  const again=await closeAccountingMonthWithReview(owner,key);
  expect(again.alreadyClosed).toBe(true);
  expect(await prisma.auditLog.count({where:{action:"books.period.close-review",entityId:key,
   userId:owner.id}})).toBe(1);
  expect((await listBooksMonthReviewAttention()).some(x=>x.href==="/desk/books/months/"+key)).toBe(false);
 });
});
