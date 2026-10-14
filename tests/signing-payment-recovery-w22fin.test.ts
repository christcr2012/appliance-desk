import { describe,expect,it } from "vitest";
import { signingPaymentRecoveryAdvice, type SigningRecoveryInput } from "@/domains/billing/signing-payment-recovery";
const fingerprint="a".repeat(64);
const base:SigningRecoveryInput={obligationStatus:"AWAITING_PAYMENT",totalCents:3500,receiptVerified:false,fingerprint};
const attempt=(status:string,method="STRIPE_CHECKOUT")=>({
  method,status,amountCents:3500,orderFingerprint:fingerprint,
});
describe("W-22FIN owner signing payment recovery decisions",()=>{
  it("permits owner-confirmed offline receipts only without an unresolved provider attempt",()=>{
    expect(signingPaymentRecoveryAdvice(base).canRecordManual).toBe(true);
    expect(signingPaymentRecoveryAdvice({...base,latestAttempt:attempt("PREPARED","MANUAL")}).canRecordManual).toBe(true);
    expect(signingPaymentRecoveryAdvice({...base,latestAttempt:attempt("FAILED")}).canRecordManual).toBe(true);
    expect(signingPaymentRecoveryAdvice({...base,latestAttempt:attempt("FAILED")}).explanation).toContain("final failure");
  });
  it("requires provider reconciliation for pending, unknown, success without receipt, and prepared checkout",()=>{
    for(const status of ["PENDING","UNKNOWN","SUCCEEDED","PREPARED"]){
      const result=signingPaymentRecoveryAdvice({...base,latestAttempt:attempt(status)});
      expect(result.canRecordManual).toBe(false);
      expect(result.providerReconciliationRequired).toBe(true);
      expect(result.explanation).not.toContain("actually received,");
    }
  });
  it("blocks foreign/mismatched attempt, corrupt obligation and unsupported states",()=>{
    for(const variant of [
      {...base,totalCents:-1},
      {...base,fingerprint:"bad"},
      {...base,latestAttempt:{...attempt("FAILED"),amountCents:3400}},
      {...base,latestAttempt:{...attempt("FAILED"),orderFingerprint:"b".repeat(64)}},
      {...base,latestAttempt:attempt("CANCELLED")},
    ]){
      expect(signingPaymentRecoveryAdvice(variant).canRecordManual).toBe(false);
    }
  });
  it("never interprets settled-but-unverified as a receipt or invoice credit",()=>{
    const mismatch=signingPaymentRecoveryAdvice({...base,obligationStatus:"SETTLED"});
    expect(mismatch.canRecordManual).toBe(false);
    expect(mismatch.providerReconciliationRequired).toBe(true);
    expect(signingPaymentRecoveryAdvice({...base,obligationStatus:"SETTLED",receiptVerified:true}).explanation)
      .toContain("First-invoice credit is verified separately");
    expect(signingPaymentRecoveryAdvice({...base,obligationStatus:"NOT_DUE",totalCents:0}).canRecordManual).toBe(false);
  });
});
