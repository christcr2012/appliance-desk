import { describe,expect,it } from "vitest";
import { summarizeAccrual,summarizeBalance,splitInvoiceCents,paybackMath,type BookReportLine } from "@/domains/books/report-math";
const line=(id:string,type:BookReportLine["accountType"],debit:number,credit:number):BookReportLine=>({
 entryId:"entry",sourceType:"INVOICE",sourceId:"inv",eventKind:"INVOICE_RECOGNIZED",
 accountId:id,accountName:id,accountType:type,systemRole:id,debitCents:debit,creditCents:credit,
});
describe("K-7 actual finance report maths",()=>{
 it("accrues income, reductions, refunds, costs and reversals using signed journal evidence",()=>{
  const r=summarizeAccrual([
   line("rent","INCOME",0,10001),line("discount","CONTRA_INCOME",1001,0),
   line("fuel","EXPENSE",400,0),line("rent","INCOME",300,0),
   line("bank","ASSET",2000,0),
  ]);
  expect(r).toMatchObject({incomeCents:9701,reductionsCents:1001,expenseCents:400,netProfitCents:8300});
  expect(r.rows.find(x=>x.accountId==="rent")?.entryIds).toEqual(["entry"]);
 });
 it("reconciles retained retirement assets without treating book transfer as loss",()=>{
  const rows=[
   line("equipment","ASSET",12000,0),line("equity","EQUITY",0,12000),
   line("depreciation","EXPENSE",6000,0),line("accumulated","CONTRA_ASSET",0,6000),
   line("retired","ASSET",6000,0),line("equipment","ASSET",0,6000),
  ];
  const b=summarizeBalance(rows);
  expect(b).toMatchObject({assetsCents:6000,liabilitiesCents:0,equityCents:12000,retainedEarningsCents:-6000,equationDifferenceCents:0});
  expect(b.rows.find(x=>x.accountId==="retired")?.balanceCents).toBe(6000);
 });
 it("rejects inaccurate money instead of returning a reassuring wrong balance",()=>{
  expect(()=>summarizeBalance([line("cash","ASSET",900,0)])).toThrow(/not balanced/);
  expect(()=>summarizeAccrual([line("income","INCOME",-1,0)])).toThrow(/Invalid journal cents/);
 });
 it("splits odd invoice cents exactly across distinct verified appliances",()=>{
  expect(splitInvoiceCents(101,["washer","dryer","washer"])).toEqual({shares:[
   {applianceId:"dryer",amountCents:51},{applianceId:"washer",amountCents:50},
  ],unallocatedCents:0});
  expect(splitInvoiceCents(-101,["washer","dryer"]).shares.map(x=>x.amountCents)).toEqual([-51,-50]);
  expect(splitInvoiceCents(91,[])).toEqual({shares:[],unallocatedCents:91});
 });
 it("repair warning compares the same trailing 12-month source window",()=>{
  const fixture={costCents:2000,rentInvoicedCents:5000,repairCostCents:3000,
   lastSixMonthsRentCents:600,bookCarryingCents:1200,rentLast12MonthsCents:1000,
   lemonRepairPercent:30};
  expect(paybackMath({...fixture,repairLast12MonthsCents:100}).repairWarning).toBe(false);
  expect(paybackMath({...fixture,repairLast12MonthsCents:400}).repairWarning).toBe(true);
 });
 it("distinguishes actual invoice payback and unknown acquisition/repair evidence",()=>{
  expect(paybackMath({costCents:5000,rentInvoicedCents:2000,repairCostCents:500,
   lastSixMonthsRentCents:1200,bookCarryingCents:3000,rentLast12MonthsCents:2500,repairLast12MonthsCents:500,
   lemonRepairPercent:30})).toMatchObject({
    netContributionCents:-3500,paybackMonths:18,paidForItself:false,repairWarning:false,bookCarryingCents:3000});
  expect(paybackMath({costCents:null,rentInvoicedCents:2000,repairCostCents:500,
   lastSixMonthsRentCents:1200,bookCarryingCents:null,rentLast12MonthsCents:0,repairLast12MonthsCents:500,
   lemonRepairPercent:30}).paybackMonths).toBeNull();
 });
});
