import { describe,expect,it } from "vitest";
import { assertSameCashSide } from "@/domains/books/cash/matching";
import { computeConservativeBankCash } from "@/domains/books/cash/readiness";
const d=(key:string)=>new Date(key+"T07:00:00.000Z");
const observation=(amount:number,key:string)=>({signedCents:amount,postedOn:d(key)});
const line=(amount:number,key:string)=>({debitCents:Math.max(amount,0),
 creditCents:Math.max(-amount,0),entry:{entryDate:d(key)}});
describe("K-CASH-3 exact cents and Colorado match policy",()=>{
 it("permits exact one-to-many and many-to-one same-sign source totals",()=>{
  expect(assertSameCashSide([observation(10800,"2026-03-10")],
   [line(10000,"2026-03-08"),line(800,"2026-03-09")],7)).toBe(10800);
  expect(assertSameCashSide([observation(-1200,"2026-03-08"),observation(-800,"2026-03-09")],
   [line(-2000,"2026-03-10")],7)).toBe(-2000);
 });
 it("rejects cross-sign netting, mismatched cents, unsafe and late source dates",()=>{
  expect(()=>assertSameCashSide([observation(100,"2026-03-09"),observation(-1,"2026-03-09")],
   [line(99,"2026-03-09")],7)).toThrow(/opposite/);
  expect(()=>assertSameCashSide([observation(99,"2026-03-09")],[line(100,"2026-03-09")],7)).toThrow(/same cents/);
  expect(()=>assertSameCashSide([observation(100,"2026-03-09")],[line(100,"2026-04-20")],7)).toThrow(/window/);
  expect(()=>assertSameCashSide([observation(Number.NaN,"2026-03-09")],[line(100,"2026-03-09")],7)).toThrow();
 });
 it("compares Colorado calendar days across spring DST and configured exact windows",()=>{
  expect(assertSameCashSide([observation(100,"2026-03-08")],[line(100,"2026-03-09")],1)).toBe(100);
  expect(()=>assertSameCashSide([observation(100,"2026-03-08")],[line(100,"2026-03-09")],0)).toThrow();
 });
});
describe("K-CASH-3 read-only, non-budget cash evidence",()=>{
 const defaults={endingCents:12000,cutoff:"2026-10-01",asOf:"2026-10-18",holdsCents:1000};
 it("adds only cleared later inflows and subtracts ALL booked later outflows once",()=>{
  const c=computeConservativeBankCash({...defaults,movements:[
   {signedCents:5000,entryDate:"2026-10-05",clearedObservationDates:["2026-10-07"]},
   {signedCents:9000,entryDate:"2026-10-05",clearedObservationDates:[]},
   {signedCents:-3000,entryDate:"2026-10-06",clearedObservationDates:["2026-10-07"]},
   {signedCents:-2000,entryDate:"2026-10-08",clearedObservationDates:[]},
  ]});
  expect(c).toMatchObject({laterClearedInCents:5000,laterBookedOutflowsCents:5000,
   unreleasedHoldsCents:1000,provisionalCents:11000});
 });
 it("subtracts old checks still outstanding and credits only subsequently matched pre-cutoff deposits",()=>{
  const c=computeConservativeBankCash({...defaults,movements:[
   {signedCents:-900,entryDate:"2026-09-28",clearedObservationDates:[]},
   {signedCents:-300,entryDate:"2026-09-28",clearedObservationDates:["2026-10-09"]},
   {signedCents:500,entryDate:"2026-09-27",clearedObservationDates:["2026-10-10"]},
   {signedCents:1500,entryDate:"2026-09-20",clearedObservationDates:[]},
   {signedCents:300,entryDate:"2026-09-20",clearedObservationDates:["2026-09-25"]},
  ]});
  expect(c.priorOutstandingOutflowsCents).toBe(1200);
  expect(c.priorClearedInflowCents).toBe(500);
  expect(c.provisionalCents).toBe(10300);
 });
 it("refuses invalid cutoffs, integer overflow and negative holds",()=>{
  expect(()=>computeConservativeBankCash({...defaults,asOf:"2026-09-01",movements:[]})).toThrow();
  expect(()=>computeConservativeBankCash({...defaults,holdsCents:-1,movements:[]})).toThrow();
  expect(()=>computeConservativeBankCash({...defaults,movements:[{
   signedCents:Number.MAX_SAFE_INTEGER,entryDate:"2026-10-05",
   clearedObservationDates:["2026-10-05"],
  }]})).toThrow();
 });
});
