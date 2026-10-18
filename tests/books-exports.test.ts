import { describe, expect, it } from "vitest";
import { formatBookExport, ExportIntegrityError, type ExportEntry } from "@/domains/books/exports/formatters";

const at=new Date("2026-10-16T06:00:00.000Z");
const base:ExportEntry={
 id:"test-entry",entryNumber:71,entryDate:at,
 memo:"Synthetic company \"sale\", do not import",sourceType:"INVOICE",eventKind:"INVOICE_RECOGNIZED",
 lines:[
  {ledgerAccountId:"bank",accountName:"Checking",externalName:"1000",externalTaxRate:"Tax Exempt",
   isPaymentSource:true,systemRole:"BANK",debitCents:10000,creditCents:0},
  {ledgerAccountId:"income",accountName:"Rental sales",externalName:"4000",externalTaxRate:"Tax Exempt",
   isPaymentSource:false,systemRole:"RENTAL_INCOME",debitCents:0,creditCents:10000},
 ],
};
const csv=(kind:"QBO_JOURNAL_CSV"|"XERO_JOURNAL_CSV"|"GENERIC_JOURNAL_CSV"|"CASH_MOVEMENTS_CSV",
mode:"DETAIL"|"DAILY_SUMMARY"="DETAIL",entries:ExportEntry[]=[base])=>formatBookExport(kind,mode,entries);
describe("K-5 immutable provider CSV formatters",()=>{
 it("writes QBO's required header, US date, stable entry number and full numeric cents",()=>{
  const text=csv("QBO_JOURNAL_CSV");
  expect(text.startsWith("Journal No,Journal Date,Account,Debits,Credits,Description\r\n")).toBe(true);
  expect(text).toContain("AD-71,10/16/2026,1000,100.00");
  expect(text).toContain("AD-71,10/16/2026,4000,,100.00");
  expect(text).toContain('"Synthetic company ""sale"", do not import"');
 });
 it("writes Xero's manual-journal schema with numeric negative credits",()=>{
  const text=csv("XERO_JOURNAL_CSV");
  expect(text.startsWith("*Narration,*Date,Description,*AccountCode,*TaxRate,*Amount\r\n")).toBe(true);
  expect(text).toContain("AD-71 / Synthetic");
  expect(text).toContain("2026/10/16");
  expect(text).toContain("1000,Tax Exempt,100.00");
  expect(text).toContain("4000,Tax Exempt,-100.00");
  expect(text).not.toContain("'-100.00");
 });
 it("writes generic entry, ISO date, mapped accounts and debit/credit columns",()=>{
  const text=csv("GENERIC_JOURNAL_CSV");
  expect(text.startsWith("Entry,Date,Account,Debit,Credit,Memo,Source\r\n")).toBe(true);
  expect(text).toContain("AD-71,2026-10-16,1000,100.00");
  expect(text).toContain("INVOICE:INVOICE_RECOGNIZED");
 });
 it("escapes formula-injection in every untrusted external account and memo",()=>{
  const hostile={...base,memo:"   =HYPERLINK(\"evil\")",lines:[
   {...base.lines[0]!,externalName:"=CMD('bad')"},
   {...base.lines[1]!,externalName:"4000"},
  ]};
  const text=csv("QBO_JOURNAL_CSV","DETAIL",[hostile]);
  expect(text).toContain("'=CMD('bad')");
  expect(text).toContain("'   =HYPERLINK");
 });
 it("nets daily entries by account and preserves balance, not double gross",()=>{
  const offset:ExportEntry={...base,id:"later",entryNumber:72,lines:base.lines.map(l=>({
   ...l,debitCents:l.creditCents,creditCents:l.debitCents,
  }))};
  const all=csv("QBO_JOURNAL_CSV","DAILY_SUMMARY",[base,offset]);
  expect(all.split("\r\n")).toHaveLength(2);
  const one=csv("GENERIC_JOURNAL_CSV","DAILY_SUMMARY",[base]);
  expect(one).toContain("AD-20261016");
  expect(one).toContain("Appliance Desk daily summary");
 });
 it("splits payment-side cents by opposite accounts with stable largest remainder",()=>{
  const multi:ExportEntry={...base,lines:[
   {...base.lines[0]!,debitCents:101,creditCents:0},
   {...base.lines[1]!,debitCents:0,creditCents:67},
   {...base.lines[1]!,ledgerAccountId:"tax",externalName:"2020",debitCents:0,creditCents:34},
  ]};
  const result=csv("CASH_MOVEMENTS_CSV","DETAIL",[multi]);
  expect(result.startsWith("Date,Account,Description,Amount,Category\r\n")).toBe(true);
  expect(result).toContain(",0.67,4000");
  expect(result).toContain(",0.34,2020");
  const summary=csv("CASH_MOVEMENTS_CSV","DAILY_SUMMARY",[multi,multi]);
  expect(summary).toContain(",1.34,4000");
 });
 it("refuses partial or unbalanced journal evidence and invalid money",()=>{
  expect(()=>csv("GENERIC_JOURNAL_CSV","DETAIL",[{...base,lines:base.lines.slice(0,1)}])).toThrow(ExportIntegrityError);
  expect(()=>csv("GENERIC_JOURNAL_CSV","DETAIL",[{...base,lines:[{...base.lines[0]!,creditCents:1},base.lines[1]!]}])).toThrow();
  expect(()=>csv("XERO_JOURNAL_CSV","DETAIL",[{...base,lines:[{...base.lines[0]!,debitCents:NaN},base.lines[1]!]}])).toThrow();
 });
});
