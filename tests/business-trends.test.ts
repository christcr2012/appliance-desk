import { describe,it,expect } from "vitest";
import { toCsv } from "@/lib/csv";
import {
 addMonths,monthKey,rangeOfMonth,reportingRange,priorWindow,monthlyKeys,
 journalProfit,bankMovement,variancePercent,sha256,type SignedJournal,
} from "@/domains/budget/report-math";
const journal=(type:string,debitCents:number,creditCents:number,overrides:Partial<SignedJournal>={}):SignedJournal=>({
 entryId:"source-1",entryDate:"2026-02-15",sourceType:"OPENING",sourceId:"fixture",eventKind:"TRIAL",
 accountId:type,accountName:type,accountType:type,systemRole:null,debitCents,creditCents,...overrides,
});
describe("K-CASH-7 real reporting whole-cent math and Colorado periods",()=>{
 it("uses signed actual journal earnings and excludes equity, sales tax, deposits, and transfer from profit",()=>{
  const rows=[
   journal("INCOME",0,10800),
   journal("CONTRA_INCOME",800,0),
   journal("EXPENSE",300,0,{systemRole:"STRIPE_FEES"}),
   journal("EXPENSE",1000,0,{systemRole:"DEPRECIATION_EXPENSE"}),
   journal("EQUITY",5000,0),
   journal("LIABILITY",0,2500,{systemRole:"SALES_TAX:COLORADO"}),
   journal("ASSET",7000,0),
  ];
  expect(journalProfit(rows)).toMatchObject({
   revenueCents:10000,costCents:1300,depreciationCents:1000,
   operatingCostCents:300,netProfitCents:8700,
  });
 });
 it("refund/void/reversal signs are net, not made absolute",()=>{
  const rows=[journal("INCOME",450,0),journal("CONTRA_INCOME",0,200),
   journal("EXPENSE",0,175)];
  expect(journalProfit(rows)).toMatchObject({
   revenueCents:-650,costCents:-175,netProfitCents:-475,
  });
 });
 it("bank internal transfers cancel without becoming revenue or spending",()=>{
  const rows=[
   journal("ASSET",12000,0,{accountId:"checking",accountName:"Checking"}),
   journal("ASSET",0,12000,{accountId:"savings",accountName:"Savings"}),
   journal("ASSET",0,310,{accountId:"checking",accountName:"Checking"}),
   journal("EXPENSE",310,0),
  ];
  expect(bankMovement(rows,["checking","savings"])).toMatchObject({
   status:"KNOWN",inflowCents:12000,outflowCents:12310,netCents:-310,
  });
  expect(bankMovement(rows,[])).toMatchObject({status:"UNKNOWN",netCents:null});
 });
 it("reports absence of plan and zero denominator explicitly, preserving signed variance",()=>{
  expect(variancePercent(null,200).label).toMatch(/Unplanned/);
  expect(variancePercent(0,200)).toMatchObject({differenceCents:200,percent:null});
  expect(variancePercent(1000,1250)).toMatchObject({differenceCents:250,percent:25,label:"Over plan"});
  expect(variancePercent(1000,750)).toMatchObject({differenceCents:-250,percent:-25,label:"Under plan"});
 });
 it("covers leap day, 31st, previous equal-length and same elapsed prior-year comparison",()=>{
  expect(rangeOfMonth("2024-02")).toEqual({from:"2024-02-01",to:"2024-02-29"});
  expect(rangeOfMonth("2026-02").to).toBe("2026-02-28");
  expect(priorWindow("2024-02-29","2024-03-02","SAME_PERIOD_LAST_YEAR"))
   .toEqual({from:"2023-02-28",to:"2023-03-02"});
  expect(priorWindow("2026-01-30","2026-02-02","PREVIOUS_PERIOD"))
   .toEqual({from:"2026-01-26",to:"2026-01-29"});
  expect(addMonths("2026-01",-1)).toBe("2025-12");
  expect(monthlyKeys("2026-10",60)).toHaveLength(60);
  expect(()=>monthlyKeys("2026-10",61)).toThrow(/1–60/);
  expect(()=>monthKey("2026-13")).toThrow(/real reporting month/);
 });
 it("validates bounded custom inclusive date window and rolls twelve months",()=>{
  expect(reportingRange("CUSTOM","2026-10-22","2025-10-22","2026-10-22"))
   .toEqual({from:"2025-10-22",to:"2026-10-22"});
  expect(()=>reportingRange("CUSTOM","2026-10-22","2025-10-20","2026-10-22"))
   .toThrow(/366 days/);
  expect(reportingRange("ROLLING_12","2026-10-22")).toEqual({from:"2025-11-01",to:"2026-10-22"});
 });
 it("deterministic hashes survive JSON key order; CSV formulas are literal, cents are numbers",()=>{
  expect(sha256({month:"2026-10",row:{a:1,b:2}}))
   .toBe(sha256({row:{b:2,a:1},month:"2026-10"}));
  const csv=toCsv([{key:"name",header:"Name"},{key:"amount",header:"Dollars"}],
   [{name:"=2+5",amount:-30},{name:"\t@unsafe",amount:15}]);
  expect(csv).toContain("'=2+5,-30");
  expect(csv).toContain("'\t@unsafe");
 });
});
