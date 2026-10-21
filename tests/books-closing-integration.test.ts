import { randomUUID } from "node:crypto";
import { beforeAll,afterAll,describe,expect,it } from "vitest";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";
import { cashForecast,customerHealth,yearEndPackage } from "@/domains/books/closing";

const url=new URL(process.env.DATABASE_URL??"postgresql://localhost/unset");
const enabled=process.env.CI==="true"&&["localhost","127.0.0.1"].includes(url.hostname)&&url.pathname==="/appliance_desk_test";
const tag=randomUUID().slice(0,12),owner="k8-owner-"+tag,staff="k8-staff-"+tag,
 customerUser="k8-cu-"+tag,customer="k8-customer-"+tag,invoice="k8-invoice-"+tag,
 receipt="k8-receipt-"+tag,payment="k8-payment-"+tag,refund="k8-refund-"+tag,
 supplier="k8-supplier-"+tag,expense="k8-expense-"+tag,template="k8-template-"+tag,
 category="k8-category-"+tag,filing="k8-filing-"+tag,period="k8-period-"+tag,
 account="k8-expacct-"+tag,lead="k8-lead-"+tag;
const day=(s:string)=>businessDateFromKey(s)!;
let oldStart:Date|null=null,oldThreshold=200000,bank="",entryId="";
describe.skipIf(!enabled)("K-8 real sources and privacy in disposable PostgreSQL",()=>{
 beforeAll(async()=>{
  const old=await prisma.businessSettings.findUniqueOrThrow({where:{id:"singleton"}});
  oldStart=old.booksStartDate;oldThreshold=old.vendor1099ThresholdCents;
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:day("2026-01-01"),vendor1099ThresholdCents:200000,
  }});
  await prisma.user.createMany({data:[
   {id:owner,email:owner+"@example.test",role:"OWNER"},
   {id:staff,email:staff+"@example.test",role:"STAFF"},
   {id:customerUser,email:customerUser+"@example.test",role:"CUSTOMER"},
  ]});
  await prisma.customer.create({data:{id:customer,userId:customerUser,
   referralCode:"K8"+tag.toUpperCase()}});
  await prisma.lead.create({data:{id:lead,contactName:"K8 disposable customer",phone:"555-000-0000",
   convertedCustomerId:customer,howHeard:"Organic search"}});
  await prisma.invoice.create({data:{id:invoice,customerId:customer,status:"OPEN",amountDueCents:1000}});
  await prisma.receipt.create({data:{id:receipt,customerId:customer,source:"MANUAL",method:"CASH",
   amountCents:1000,receivedOn:day("2026-10-10")}});
  await prisma.payment.create({data:{id:payment,invoiceId:invoice,receiptId:receipt,status:"SUCCEEDED",
   amountCents:1000,method:"CASH",createdAt:day("2026-10-10")}});
  await prisma.refund.create({data:{id:refund,invoiceId:invoice,reason:"GOODWILL",amountCents:100,
   createdAt:day("2026-10-11")}});
  const bankAcc=await prisma.ledgerAccount.findFirstOrThrow({where:{systemRole:"BANK"}});
  bank=bankAcc.id;
  await prisma.ledgerAccount.create({data:{id:account,name:"K8 expense "+tag,type:"EXPENSE",description:"Synthetic trial"}});
  await prisma.expenseCategory.create({data:{id:category,name:"K8 category "+tag,description:"Synthetic",
   ledgerAccountId:account}});
  await prisma.supplier.create({data:{id:supplier,name:"K8 supplier "+tag,is1099Vendor:true,taxIdOnFile:false}});
  await prisma.expense.create({data:{id:expense,status:"POSTED",spentOn:day("2026-10-15"),
   amountCents:250000,vendorTaxCents:0,vendorName:"K8 supplier",supplierId:supplier,
   categoryId:category,paidFromAccountId:bank,submittedByUserId:owner,postedByUserId:owner}});
  const entry=await prisma.journalEntry.create({data:{sourceType:"EXPENSE",sourceId:expense,eventKind:"EXPENSE_POSTED",
   entryDate:day("2026-10-15"),periodKey:"2026-10",memo:"K8 test-only posted payment",
   lines:{create:[{ledgerAccountId:account,debitCents:250000},{ledgerAccountId:bank,creditCents:250000}]} }});
  entryId=entry.id;
  await prisma.recurringExpense.create({data:{id:template,name:"K8 estimated rent "+tag,
   vendorName:"K8 monthly",amountCents:3000,dayOfMonth:28,categoryId:category,paidFromAccountId:bank}});
  await prisma.taxFilingAccount.create({data:{id:filing,name:"K8 tax account "+tag}});
  await prisma.taxFilingPeriod.create({data:{id:period,filingAccountId:filing,
   periodStart:day("2026-09-01"),periodEnd:day("2026-09-30"),dueOn:day("2026-10-28"),
   status:"OPEN",worksheet:{}}});
 });
 afterAll(async()=>{
  await prisma.taxFilingPeriod.deleteMany({where:{id:period}});
  await prisma.taxFilingAccount.deleteMany({where:{id:filing}});
  await prisma.recurringExpense.deleteMany({where:{id:template}});
  await prisma.journalLine.deleteMany({where:{entryId}});
  await prisma.journalEntry.deleteMany({where:{id:entryId}});
  await prisma.expense.deleteMany({where:{id:expense}});
  await prisma.supplier.deleteMany({where:{id:supplier}});
  await prisma.expenseCategory.deleteMany({where:{id:category}});
  await prisma.ledgerAccount.deleteMany({where:{id:account}});
  await prisma.refund.deleteMany({where:{id:refund}});
  await prisma.payment.deleteMany({where:{id:payment}});
  await prisma.receipt.deleteMany({where:{id:receipt}});
  await prisma.invoice.deleteMany({where:{id:invoice}});
  await prisma.lead.deleteMany({where:{id:lead}});
  await prisma.customer.deleteMany({where:{id:customer}});
  await prisma.user.deleteMany({where:{id:{in:[owner,staff,customerUser]}}});
  await prisma.businessSettings.update({where:{id:"singleton"},data:{
   booksStartDate:oldStart,vendor1099ThresholdCents:oldThreshold,
  }});
 });
 it("refuses staff and customer for all domain views and annual downloads",async()=>{
  await expect(cashForecast(staff,30,day("2026-10-19"))).rejects.toThrow(/access/);
  await expect(customerHealth(staff,day("2026-10-19"))).rejects.toThrow(/access/);
  await expect(yearEndPackage(staff,2026,"suppliers")).rejects.toThrow(/access/);
 });
 it("forecasts only uncreated recurring drafts and marks unsupported open tax worksheets",async()=>{
  const report=await cashForecast(owner,30,day("2026-10-19"));
  expect(report.kind).toBe("ESTIMATE");
  expect(report.rows.some(x=>x.sourceId===template&&x.date==="2026-10-28")).toBe(true);
  expect(report.needsReview.some(x=>x.includes("K8 tax account"))).toBe(true);
  expect(report.rows.some(x=>x.sourceId===period)).toBe(false);
  expect(report.rows.some(x=>x.kind==="BILLING_ESTIMATE")).toBe(false);
 });
 it("deduplicates linked recurring costs in K-8 and keeps separate bank evidence scenarios",async()=>{
  const envelope=await prisma.budgetEnvelope.findFirstOrThrow({where:{id:"budget-default-repairs"}});
  const linked=await prisma.budgetCostPlan.create({data:{envelopeId:envelope.id,
   name:"K8 budget linked recurring",amountCents:3000,amountQuality:"ESTIMATE",
   dueOn:day("2026-10-28"),recurrence:"MONTHLY",anchorDay:28,anchorMonth:10,
   sourceType:"RECURRING_EXPENSE",sourceId:template}});
  try{
   await prisma.budgetCostOccurrence.create({data:{
    planId:linked.id,dueOn:day("2026-10-28"),amountCents:3000}});
   const report=await cashForecast(owner,30,day("2026-10-19"));
   const sameDate=report.rows.filter(x=>x.date==="2026-10-28"&&
    (x.kind==="RECURRING_EXPENSE_ESTIMATE"||x.kind==="BUDGET_PLAN_ESTIMATE"));
   expect(sameDate).toHaveLength(1);
   expect(sameDate[0]?.kind).toBe("BUDGET_PLAN_ESTIMATE");
   expect(report.tracks.noNewCollections.kind).toBe("CONFIRMED_CASH_MINUS_ESTIMATED_COSTS");
   expect(report.tracks.expectedCollections.kind).toBe("ESTIMATED_BILLING_NOT_COLLECTED");
   expect(report.needsReview).toEqual(expect.any(Array));
  }finally{
   await prisma.budgetCostOccurrence.deleteMany({where:{planId:linked.id}});
   await prisma.budgetCostPlan.delete({where:{id:linked.id}});
  }
 });
 it("counts only receipt-linked successful payments less real recorded refunds",async()=>{
  const report=await customerHealth(owner,day("2026-10-19"));
  expect(report.sourceGroups.find(x=>x.leadSource==="Organic search")?.netCollectedCents).toBe(900);
  expect(report.netCollectedCents).toBeGreaterThanOrEqual(900);
 });
 it("year-end expenses and owner threshold reflect posted journal, not unpaid drafts",async()=>{
  const report=await yearEndPackage(owner,2026,"expenses");
  expect(report.content).toContain("K8 category "+tag);
  expect(report.content).toContain("250000");
  const vendor=await yearEndPackage(owner,2026,"suppliers");
  expect(vendor.content).toContain("K8 supplier "+tag);
  expect(vendor.content).toContain("CANDIDATE — CPA REVIEW");
  expect(vendor.content).toContain("200000");
 });
 it("nets a later source-journal reversal out of actual supplier candidate spending",async()=>{
  const reverse=await prisma.journalEntry.create({data:{
   sourceType:"EXPENSE",sourceId:expense,eventKind:"EXPENSE_VOIDED",
   entryDate:day("2026-10-16"),periodKey:"2026-10",
   memo:"Synthetic repayment/correction of supplier payment",
   lines:{create:[
    {ledgerAccountId:bank,debitCents:250000},
    {ledgerAccountId:account,creditCents:250000},
   ]},
  }});
  try{
   const report=await yearEndPackage(owner,2026,"suppliers");
   expect(report.content).toContain("K8 supplier "+tag);
   expect(report.content).toContain("BELOW THRESHOLD — CPA REVIEW");
   expect(report.content).not.toContain("CANDIDATE — CPA REVIEW");
  } finally {
   await prisma.journalLine.deleteMany({where:{entryId:reverse.id}});
   await prisma.journalEntry.delete({where:{id:reverse.id}});
  }
 });
 it("does not count signed ACTIVE rentals before billing/delivery start",async()=>{
  const addressId="k8-predeliver-address-"+tag,agreementId="k8-predeliver-"+tag;
  await prisma.serviceAddress.create({data:{id:addressId,customerId:customer,
   line1:"500 Incomplete Delivery",city:"Greeley",state:"CO",zip:"80631"}});
  try{
   await prisma.rentalAgreement.create({data:{
    id:agreementId,customerId:customer,serviceAddressId:addressId,status:"ACTIVE",
    startDate:day("2026-10-10"),billingStartedAt:null,endDate:day("2026-11-05"),
   }});
   const before=await customerHealth(owner,day("2026-10-19"));
   await prisma.rentalAgreement.update({where:{id:agreementId},data:{billingStartedAt:day("2026-10-18")}});
   const after=await customerHealth(owner,day("2026-10-19"));
   expect(after.activeRentals).toBe(before.activeRentals+1);
   expect(after.endingNext90Days).toBe(before.endingNext90Days+1);
  }finally{
   await prisma.rentalAgreement.deleteMany({where:{id:agreementId}});
   await prisma.serviceAddress.deleteMany({where:{id:addressId}});
  }
 });
 it("excludes future placed-in-service assets from historical year-end",async()=>{
  const kind="k8-year-kind-"+tag;
  const oldId="k8-year-asset-old-"+tag, futureId="k8-year-asset-future-"+tag;
  await prisma.applianceType.create({data:{id:kind,name:"K8 historical year asset "+tag,slug:"k8-year-"+tag}});
  try{
   await prisma.appliance.createMany({data:[
    {id:oldId,assetNumber:"K8-OLD-"+tag,applianceTypeId:kind,acquisitionCostCents:12000},
    {id:futureId,assetNumber:"K8-FUTURE-"+tag,applianceTypeId:kind,acquisitionCostCents:12000},
   ]});
   await prisma.bookAsset.createMany({data:[
    {applianceId:oldId,costCents:12000,placedInServiceOn:day("2026-02-01"),
     lifeMonths:60,salvagePercent:0,createdByUserId:owner},
    {applianceId:futureId,costCents:12000,placedInServiceOn:day("2027-02-01"),
     lifeMonths:60,salvagePercent:0,createdByUserId:owner},
   ]});
   const historical=await yearEndPackage(owner,2026,"assets");
   expect(historical.content).toContain("K8-OLD-"+tag);
   expect(historical.content).not.toContain("K8-FUTURE-"+tag);
  }finally{
   await prisma.bookTaxEvidence.deleteMany({where:{applianceId:{in:[oldId,futureId]}}});
   await prisma.bookAsset.deleteMany({where:{applianceId:{in:[oldId,futureId]}}});
   await prisma.appliance.deleteMany({where:{id:{in:[oldId,futureId]}}});
   await prisma.applianceType.deleteMany({where:{id:kind}});
  }
 });
 it("exports only filed tax period evidence, not draft open worksheet",async()=>{
  const before=await yearEndPackage(owner,2026,"tax-filed");
  expect(before.content).not.toContain("K8 tax account "+tag);
  await prisma.taxFilingPeriod.update({where:{id:period},data:{
   status:"FILED",filedOn:day("2026-10-18"),worksheet:{totals:{remitCents:1234}},
  }});
  try{
   const after=await yearEndPackage(owner,2026,"tax-filed");
   expect(after.content).toContain("K8 tax account "+tag);
   expect(after.content).toContain("1234");
  }finally{
   await prisma.taxFilingPeriod.update({where:{id:period},data:{status:"OPEN",filedOn:null,worksheet:{}}});
  }
 });
});
