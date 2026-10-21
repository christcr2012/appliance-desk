import { describe,expect,it } from "vitest";
import { plannedDueKeys,suggestedTarget,fundNowNeed,fundingSuggestion } from "@/domains/budget/planning-math";
describe("K-CASH-5A deterministic Colorado cost and envelope planning",()=>{
 it("clamps month ends independently without permanently drifting a January 31 anchor",()=>{
  expect(plannedDueKeys({anchor:"2026-01-31",recurrence:"MONTHLY",
   from:"2026-01-01",through:"2026-05-31"})).toEqual([
    "2026-01-31","2026-02-28","2026-03-31","2026-04-30","2026-05-31"]);
  expect(plannedDueKeys({anchor:"2026-01-31",recurrence:"QUARTERLY",
   from:"2026-01-01",through:"2026-12-31"})).toEqual([
    "2026-01-31","2026-04-30","2026-07-31","2026-10-31"]);
 });
 it("keeps February 29 annual costs on a real civil day and restores leap day",()=>{
  expect(plannedDueKeys({anchor:"2024-02-29",recurrence:"ANNUAL",
   from:"2025-01-01",through:"2028-12-31"})).toEqual([
    "2025-02-28","2026-02-28","2027-02-28","2028-02-29"]);
 });
 it("bounds visible occurrences, rejects invalid civil dates and never backdates a one-time bill",()=>{
  expect(plannedDueKeys({anchor:"2026-11-03",recurrence:"NONE",
   from:"2026-10-01",through:"2026-10-31"})).toEqual([]);
  expect(()=>plannedDueKeys({anchor:"2026-02-29",recurrence:"ANNUAL",
   from:"2026-01-01",through:"2026-12-31"})).toThrow(/real Colorado/);
  expect(()=>plannedDueKeys({anchor:"2026-01-01",recurrence:"MONTHLY",
   from:"2026-01-01",through:"2030-12-31",max:2})).toThrow(/too many/);
 });
 it("applies monthly spending carryover without double counting money already spent",()=>{
  expect(suggestedTarget({kind:"MONTHLY_SPEND",amountCents:10000,
   balanceCents:0,netSpentThisMonthCents:3000,today:"2026-10-21"}).neededCents).toBe(7000);
  expect(suggestedTarget({kind:"MONTHLY_SPEND",amountCents:10000,
   balanceCents:3000,netSpentThisMonthCents:2000,today:"2026-10-21"}).neededCents).toBe(5000);
 });
 it("uses rounded-up cents for 1,000 dollars saved over three included months",()=>{
  expect(suggestedTarget({kind:"SAVE_BY_DATE",amountCents:100000,
   balanceCents:0,netSpentThisMonthCents:0,today:"2026-10-21",
   dueOn:"2026-12-31"})).toMatchObject({neededCents:100000,
    suggestedPerMonthCents:33334,nextDueOn:"2026-12-31"});
 });
 it("covers a negative balance before any unrelated savings goal",()=>{
  expect(fundNowNeed({balanceCents:-1200,targetNeedCents:0,unpaidUpcomingCents:0})).toBe(1200);
 });
 it("does not add the same upcoming insurance bill to its target",()=>{
  expect(fundNowNeed({balanceCents:3000,targetNeedCents:17000,
   unpaidUpcomingCents:20000})).toBe(17000);
  expect(fundNowNeed({balanceCents:3000,targetNeedCents:3000,
   unpaidUpcomingCents:20000})).toBe(17000);
 });
 it("orders shortages ahead of targets, conserves exact whole cents and labels unknown cash",()=>{
  const c=[
   {id:"monthly",currentCents:0,needCents:6000,priority:"MONTHLY_SPEND" as const,dueOn:null,sortOrder:0},
   {id:"negative",currentCents:-1000,needCents:1000,priority:"NEGATIVE" as const,dueOn:null,sortOrder:0},
   {id:"bill",currentCents:0,needCents:5000,priority:"BILL" as const,dueOn:"2026-11-01",sortOrder:0}];
  expect(fundingSuggestion(c,null)).toMatchObject({legs:[],unfundedCents:null});
  const result=fundingSuggestion(c,4000);
  expect(result.legs.map(x=>[x.envelopeId,x.signedCents])).toEqual([
    ["negative",1000],["bill",3000]]);
  expect(result.unfundedCents).toBe(8000);
 });
});
