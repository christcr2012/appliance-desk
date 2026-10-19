import { describe, expect, it } from "vitest";
import { monthlySchedule, remainingSchedule, nextMonth, lastBusinessDay, BookAssetInputError } from "@/domains/books/depreciation";
import { businessDateKey } from "@/lib/business-date";
describe("K-6 management depreciation, never tax depreciation",()=>{
 it("spreads integer cents exactly and adds rounding only in last month",()=>{
  const rows=monthlySchedule({costCents:10001,salvagePercent:10,months:6,startMonth:"2026-02"});
  expect(rows.map(x=>x.periodKey)).toEqual(["2026-02","2026-03","2026-04","2026-05","2026-06","2026-07"]);
  expect(rows.map(x=>x.amountCents)).toEqual([1500,1500,1500,1500,1500,1501]);
  expect(rows.reduce((sum,x)=>sum+x.amountCents,0)).toBe(9001);
 });
 it("uses calendar months and each last Colorado day through DST",()=>{
  expect(nextMonth("2026-12")).toBe("2027-01");
  expect(businessDateKey(lastBusinessDay("2026-02"))).toBe("2026-02-28");
  expect(businessDateKey(lastBusinessDay("2026-03"))).toBe("2026-03-31");
  expect(businessDateKey(lastBusinessDay("2026-11"))).toBe("2026-11-30");
  const schedule=monthlySchedule({costCents:601,salvagePercent:0,months:12,startMonth:"2026-11"});
  expect(schedule[11]?.periodKey).toBe("2027-10");
  expect(schedule.reduce((sum,x)=>sum+x.amountCents,0)).toBe(601);
 });
 it("recalculates only unposted months after a life edit",()=>{
  const old=monthlySchedule({costCents:1101,salvagePercent:0,months:11,startMonth:"2026-02"});
  const posted=old[0]!.amountCents+old[1]!.amountCents;
  const future=remainingSchedule({costCents:1101,salvagePercent:0,months:8,
   postedCents:posted,postedMonths:2,nextUnpostedMonth:"2026-04"});
  expect(future).toHaveLength(6);
  expect(future[0]?.periodKey).toBe("2026-04");
  expect(future.reduce((sum,x)=>sum+x.amountCents,0)+posted).toBe(1101);
 });
 it("refuses unsafe cents, unsupported life/salvage and impossible edits",()=>{
  expect(()=>monthlySchedule({costCents:NaN,months:60,salvagePercent:0,startMonth:"2026-02"})).toThrow(BookAssetInputError);
  expect(()=>monthlySchedule({costCents:100,months:0,salvagePercent:0,startMonth:"2026-02"})).toThrow();
  expect(()=>monthlySchedule({costCents:100,months:60,salvagePercent:96,startMonth:"2026-02"})).toThrow();
  expect(()=>remainingSchedule({costCents:1000,months:3,salvagePercent:95,
   postedCents:100,postedMonths:1,nextUnpostedMonth:"2026-03"})).toThrow();
 });
 it("keeps zero-cent months as explicit schedule slots",()=>{
  const rows=monthlySchedule({costCents:1,salvagePercent:0,months:12,startMonth:"2026-02"});
  expect(rows.slice(0,11).every(r=>r.amountCents===0)).toBe(true);
  expect(rows[11]?.amountCents).toBe(1);
 });
});
