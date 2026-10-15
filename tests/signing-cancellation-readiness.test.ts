import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { getSigningCancellationPaymentInTx } from "@/domains/billing/signing-cancellation-readiness";

const fingerprint="a".repeat(64);
const attempt=(status:string,method="STRIPE_CHECKOUT")=>({
  status,method,amountCents:10500,orderFingerprint:fingerprint,
});
const settled=()=>({status:"SETTLED",totalCents:10500,orderFingerprint:fingerprint,
  receiptId:"receipt",receipt:{id:"receipt",customerId:"customer",amountCents:10500},
  attempts:[attempt("SUCCEEDED")],
});
async function review(value:unknown) {
  const lock=vi.fn(async()=>[]);
  const read=vi.fn(async()=>value);
  const tx={$queryRaw:lock,agreementSigningPayment:{findUnique:read}} as unknown as Prisma.TransactionClient;
  const result=await getSigningCancellationPaymentInTx(tx,"agreement","customer");
  expect(lock).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(read.mock.invocationCallOrder[0]);
  return result;
}
describe("cancellation never discards unreconciled signing money",()=>{
  it("preserves legacy cancellation without a signing obligation",async()=>{
    expect(await review(null)).toBeNull();
  });
  it.each(["PREPARED","PENDING"])("denies a %s provider attempt even beside a settled receipt",async status=>{
    await expect(review({...settled(),attempts:[attempt(status)]})).rejects.toThrow(/pending or unverified/);
  });
  it("denies succeeded without a settled receipt",async()=>{
    await expect(review({...settled(),status:"AWAITING_PAYMENT",receipt:null,receiptId:null}))
      .rejects.toThrow(/may have succeeded/);
  });
  it.each(["amount","fingerprint","duplicate"])("denies conflicting successful evidence: %s",async kind=>{
    const row=settled();
    if(kind==="amount")row.attempts[0].amountCents=100;
    if(kind==="fingerprint")row.attempts[0].orderFingerprint="b".repeat(64);
    if(kind==="duplicate")row.attempts.push(attempt("SUCCEEDED","MANUAL"));
    await expect(review(row)).rejects.toThrow(/Reconcile/);
  });
  it("denies a foreign customer's receipt",async()=>{
    const row=settled();row.receipt.customerId="other";
    await expect(review(row)).rejects.toThrow(/receipt disagree/);
  });
  it("permits reconciled success to reach independent owner refund review",async()=>{
    expect(await review(settled())).toMatchObject({status:"SETTLED",receiptId:"receipt"});
  });
  it("does not mistake a failed or uncollected manual reservation for received money",async()=>{
    const row={...settled(),status:"AWAITING_PAYMENT",receipt:null,receiptId:null,
      attempts:[attempt("FAILED"),attempt("PREPARED","MANUAL")]};
    expect(await review(row)).toMatchObject({status:"AWAITING_PAYMENT",receipt:null});
  });
});
