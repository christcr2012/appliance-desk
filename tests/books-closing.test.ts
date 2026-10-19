import { describe,expect,it } from "vitest";
import { businessDateFromKey,businessDateKey } from "@/lib/business-date";
import {
 BooksClosingError,futureBillingDates,recurringDates,refundAdjustedCollection,
 avgRentalMonths,cashTotals,calendarKey,
} from "@/domains/books/closing-math";
const day=(s:string)=>businessDateFromKey(s)!;
describe("K-8 source and Colorado calendar math",()=>{
 it("preserves January 31 billing anniversaries and February short month",()=>{
  const rows=futureBillingDates(day("2026-01-31"),day("2026-01-20"),day("2026-05-01"));
  expect(rows.map(businessDateKey)).toEqual(["2026-01-31","2026-02-28","2026-03-31","2026-04-30"]);
 });
 it("keeps DST Colorado bill-date recurrence rather than adding fixed 30-day milliseconds",()=>{
  expect(futureBillingDates(day("2026-03-08"),day("2026-03-08"),day("2026-05-01")).map(businessDateKey))
   .toEqual(["2026-03-08","2026-04-08"]);
 });
 it("keeps day 28 monthly templates and bounds invalid dates",()=>{
  expect(recurringDates(28,"2026-10-19","2027-01-31"))
   .toEqual(["2026-10-28","2026-11-28","2026-12-28","2027-01-28"]);
  expect(()=>recurringDates(31,"2026-10-01","2026-12-31")).toThrow(BooksClosingError);
  expect(()=>calendarKey("2026-02-30")).toThrow(BooksClosingError);
 });
 it("reconciles estimate cash directions without treating outflows as income",()=>{
  const totals=cashTotals([
   {date:"2026-11-01",kind:"BILLING_ESTIMATE",amountCents:5000,sourceId:"bill",label:"Rent",confidence:"ESTIMATE"},
   {date:"2026-11-02",kind:"RECURRING_EXPENSE_ESTIMATE",amountCents:1500,sourceId:"rent",label:"Parts",confidence:"ESTIMATE"},
   {date:"2026-11-03",kind:"TAX_WORKSHEET_ESTIMATE",amountCents:500,sourceId:"tax",label:"Tax",confidence:"ESTIMATE"},
  ]);
  expect(totals).toEqual({inflowCents:5000,outflowCents:2000,netCents:3000});
 });
 it("uses only supported refunded receipts and evidenced completed rentals",()=>{
  expect(refundAdjustedCollection(10001,501)).toBe(9500);
  expect(avgRentalMonths([{start:"2026-01-01",end:"2026-01-31"}])).toBe(1);
  expect(avgRentalMonths([])).toBeNull();
  expect(()=>refundAdjustedCollection(100,-1)).toThrow(BooksClosingError);
 });
});
