import { beforeEach,describe,expect,it,vi } from "vitest";

const m=vi.hoisted(()=>({
  invoice:vi.fn(),receipts:vi.fn(),post:vi.fn(),systemIssue:vi.fn(),
  transaction:vi.fn(),
}));
vi.mock("@/lib/prisma",()=>({prisma:{
 invoice:{findUnique:m.invoice},
 receipt:{findMany:m.receipts},
 $transaction:m.transaction,
}}));
vi.mock("@/domains/books/post",()=>({postForSource:m.post}));
vi.mock("@/domains/system-issues",()=>({
 recordSystemIssue:m.systemIssue,
}));
import { postPaidInvoiceAfterWebhook } from "@/domains/books/immediate";

describe("BA-1 paid-invoice webhook: post after the real business transaction",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  m.invoice.mockResolvedValue({id:"invoice-local"});
  m.receipts.mockResolvedValue([{id:"receipt-a"},{id:"receipt-b"}]);
  m.transaction.mockImplementation((f:(tx:unknown)=>Promise<void>)=>f({}));
  m.post.mockResolvedValue(undefined);
  m.systemIssue.mockResolvedValue(undefined);
 });
 it("uses saved receipt IDs and does not trust the Stripe event's amount",async()=>{
  await postPaidInvoiceAfterWebhook("stripe-invoice-1");
  expect(m.invoice).toHaveBeenCalledWith({where:{stripeInvoiceId:"stripe-invoice-1"},
   select:{id:true}});
  expect(m.receipts).toHaveBeenCalledWith(expect.objectContaining({
   where:{payments:{some:{invoiceId:"invoice-local"}}},
   take:20,
  }));
  expect(m.post.mock.calls.map(c=>c.slice(1))).toEqual([
   ["RECEIPT","receipt-a"],["RECEIPT","receipt-b"],["INVOICE","invoice-local"],
  ]);
  expect(m.systemIssue).not.toHaveBeenCalled();
 });
 it("does not invent an invoice or journal when the provider invoice is unknown",async()=>{
  m.invoice.mockResolvedValue(null);
  await postPaidInvoiceAfterWebhook("unrecognized");
  expect(m.receipts).not.toHaveBeenCalled();
  expect(m.post).not.toHaveBeenCalled();
 });
 it("a failed receipt book posting cannot undo the paid invoice or block later sources",async()=>{
  m.post.mockRejectedValueOnce(new Error("Transient journal write problem"));
  await expect(postPaidInvoiceAfterWebhook("stripe-invoice-1")).resolves.toBeUndefined();
  expect(m.post).toHaveBeenCalledTimes(3);
  expect(m.systemIssue).toHaveBeenCalledWith(expect.objectContaining({
   kind:"BOOKS_POSTING_FAILURE",sourceType:"RECEIPT",sourceId:"receipt-a",
  }));
 });
});
