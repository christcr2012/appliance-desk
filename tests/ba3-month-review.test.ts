import { describe, expect, it } from "vitest";
import { businessDateFromKey } from "@/lib/business-date";
import { assetDueForMonth } from "@/domains/books/month-review";
import { checkExpenseFields } from "@/domains/books/expenses";

const d=(key:string)=>businessDateFromKey(key)!;
const asset=(overrides:Partial<{
 placedInServiceOn:Date;retiredOn:Date|null;
 fullyDepreciatedOn:Date|null;lifeMonths:number;
}>={})=>({
 placedInServiceOn:d("2026-01-15"),retiredOn:null,fullyDepreciatedOn:null,lifeMonths:3,
 ...overrides,
});
const expense={
 date:"2026-01-15",amountCents:1000,vendorTaxCents:0,vendorName:"Hardware store",
 categoryId:"test-category",paidFromAccountId:"test-account",
};
describe("BA-3 month reviews and source-backed receipt evidence",()=>{
 it("skips months before placement and the placement month, then checks each due month",()=>{
  expect(assetDueForMonth(asset(),"2025-12")).toBe(false);
  expect(assetDueForMonth(asset(),"2026-01")).toBe(false);
  expect(assetDueForMonth(asset(),"2026-02")).toBe(true);
  expect(assetDueForMonth(asset(),"2026-04")).toBe(true);
  expect(assetDueForMonth(asset(),"2026-05")).toBe(false);
 });
 it("does not demand depreciation for assets enrolled after the month under review",()=>{
  expect(assetDueForMonth(asset({placedInServiceOn:d("2026-03-17")}),"2026-02")).toBe(false);
 });
 it("does not demand depreciation after retirement or full depreciation",()=>{
  expect(assetDueForMonth(asset({retiredOn:d("2026-02-16")}),"2026-02")).toBe(true);
  expect(assetDueForMonth(asset({retiredOn:d("2026-02-16")}),"2026-03")).toBe(false);
  expect(assetDueForMonth(asset({fullyDepreciatedOn:d("2026-02-28")}),"2026-03")).toBe(false);
 });
 it("requires a concrete reason whenever someone attests that no receipt exists",()=>{
  expect(()=>checkExpenseFields({...expense,noReceipt:true,noReceiptReason:" "})).toThrow(/Explain/);
  expect(checkExpenseFields({...expense,noReceipt:true,noReceiptReason:"Customer paid cash; invoice number 12"}))
   .toMatchObject({noReceiptReason:"Customer paid cash; invoice number 12"});
  expect(()=>checkExpenseFields({...expense,noReceipt:true,noReceiptReason:"a".repeat(201)})).toThrow(/long/);
  expect(checkExpenseFields({...expense,noReceiptReason:"Unattested text"})).not.toHaveProperty("noReceiptReason");
 });
});
