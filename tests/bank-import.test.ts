import { describe, expect, it } from "vitest";
import { decodeCsv, parseBankCsv, redactBankDescription, type BankCsvMapping } from "@/domains/books/cash/csv";
import { cashEventPlan } from "@/domains/books/cash/event-plan";
const csv=(s:string)=>new TextEncoder().encode(s);
const mapping:BankCsvMapping={schemaVersion:1,dateColumn:"Date",descriptionColumn:"Description",
 amountColumn:"Amount",dateFormat:"MM/DD/YYYY",bankCreditIsPositive:true};
describe("K-CASH-2 strict settled bank import parser",()=>{
 it("retains same-day identical legitimate observations and quoted newline/commas",()=>{
  const result=parseBankCsv(csv('Date,Description,Amount\r\n10/17/2026,"Parts, washer", -0.01\r\n10/17/2026,"Parts, washer",-0.01\r\n'),mapping);
  expect(result.rows).toHaveLength(2);
  expect(result.rows[0]?.description).toBe("Parts, washer");
  expect(result.rows[0]?.occurrenceIndex).toBe(1);
  expect(result.rows[1]?.occurrenceIndex).toBe(2);
  expect(result.rows[0]?.fingerprint).toBe(result.rows[1]?.fingerprint);
  expect(result.totalOutflowsCents).toBe(2);
  const multiline=decodeCsv('"Date","Description","Amount"\r\n"10/17/2026","memo\nnext line","1.01"');
  expect(multiline[1]?.[1]).toBe("memo\nnext line");
 });
 it("validates signed amount and debit/credit layouts without floating point rounding",()=>{
  const signed=parseBankCsv(csv("Date,Description,Amount\n10/17/2026,Refund,0.01"),mapping);
  expect(signed.rows[0]?.signedCents).toBe(1);
  const split:BankCsvMapping={schemaVersion:1,dateColumn:"Date",descriptionColumn:"Description",
   debitColumn:"Debit",creditColumn:"Credit",dateFormat:"YYYY-MM-DD",bankCreditIsPositive:true};
  const result=parseBankCsv(csv("Date,Description,Debit,Credit\n2026-10-17,Transfer,100.00,\n"),split);
  expect(result.rows[0]?.signedCents).toBe(-10000);
  expect(()=>parseBankCsv(csv("Date,Description,Debit,Credit\n2026-10-17,Invalid,1,2"),split)).toThrow(/both debit and credit/);
 });
 it("rejects exponent dollars, malformed quoted rows, invalid calendar dates and invalid UTF-8",()=>{
  expect(()=>parseBankCsv(csv("Date,Description,Amount\n10/17/2026,Fuel,1e3"),mapping)).toThrow(/decimal/);
  expect(()=>parseBankCsv(csv('Date,Description,Amount\n10/17/2026,"unterminated,1.00'),mapping)).toThrow(/Unterminated/);
  expect(()=>parseBankCsv(csv("Date,Description,Amount\n02/30/2026,Wrong,1"),mapping)).toThrow(/nonexistent/);
  expect(()=>parseBankCsv(new Uint8Array([0xff,0xfe,0x00,0x00,0x00]),mapping)).toThrow(/UTF-8/);
  expect(()=>parseBankCsv(new Uint8Array(5*1024*1024+1),mapping)).toThrow(/5 MiB/);
 });
 it("redacts likely social security, card and full account strings before persistence",()=>{
  expect(redactBankDescription("User 123-45-6789 paid acct 1234567890123456")).not.toContain("123-45-6789");
  expect(redactBankDescription("User 123-45-6789 paid acct 1234567890123456")).not.toContain("1234567890123456");
 });
 it("refuses duplicate or missing column names, invalid mapping and zero-value movements",()=>{
  expect(()=>parseBankCsv(csv("Date,Date,Amount\n10/17/2026,Fuel,12"),mapping)).toThrow(/unique/);
  expect(()=>parseBankCsv(csv("Date,Description,Amount\n10/17/2026,Fuel,0"),mapping)).toThrow(/nonzero/);
 });
});
const base={kind:"BANK_TRANSFER",amountCents:125,occurredOn:new Date("2026-10-17T06:00:00Z"),
 memo:"Synthetic internal transfer",fromLedgerAccountId:"bank_original",toLedgerAccountId:"bank_target",reversalOfId:null};
describe("K-CASH-2 typed journal safety",()=>{
 it("moves between two bank assets without income or expense",()=>{
  const plan=cashEventPlan(base);
  expect(plan.lines.map(x=>x.role)).toEqual(["ID:bank_target","ID:bank_original"]);
  expect(plan.lines.reduce((n,x)=>n+x.debitCents-x.creditCents,0)).toBe(0);
 });
 it("creates inverse lines for a genuine reversal and refuses same-account transfers",()=>{
  const posted=cashEventPlan(base),reversed=cashEventPlan({...base,reversalOfId:"reversed_source"});
  expect(reversed.lines.map((x,i)=>({debitCents:x.debitCents,creditCents:x.creditCents})))
    .toEqual(posted.lines.map(x=>({debitCents:x.creditCents,creditCents:x.debitCents})));
  expect(()=>cashEventPlan({...base,toLedgerAccountId:base.fromLedgerAccountId})).toThrow(/distinct/);
 });
 it("assigns known equity/income/liability rather than guesses",()=>{
  const contribution=cashEventPlan({...base,kind:"OWNER_CONTRIBUTION",fromLedgerAccountId:null});
  expect(contribution.lines.map(x=>x.role)).toEqual(["ID:bank_target","OWNER_CONTRIBUTIONS"]);
  const interest=cashEventPlan({...base,kind:"BANK_INTEREST",fromLedgerAccountId:null});
  expect(interest.lines[1]?.role).toBe("INTEREST_INCOME");
  const draw=cashEventPlan({...base,kind:"OWNER_DRAW",toLedgerAccountId:null});
  expect(draw.lines[0]?.role).toBe("OWNER_DRAWS");
  const card=cashEventPlan({...base,kind:"CARD_PAYMENT",toLedgerAccountId:null});
  expect(card.lines[0]?.role).toBe("CARD");
  const deposit=cashEventPlan({...base,kind:"CASH_DEPOSIT",fromLedgerAccountId:null});
  expect(deposit.lines[1]?.role).toBe("UNDEPOSITED");
 });
});
