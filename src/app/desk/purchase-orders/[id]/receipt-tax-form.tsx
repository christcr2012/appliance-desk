"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Select } from "@/components/ui";
import { updateReceiptTaxAction } from "../../purchasing-actions";

export function ReceiptTaxForm({ receiptTaxId, purchaseOrderId, revisionAt }: { receiptTaxId: string; purchaseOrderId: string; revisionAt: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState("");
  const [tax, setTax] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const taxed = answer === "YES_COLORADO" || answer === "YES_OTHER_STATE";
  return (
    <form className="space-y-3 rounded-card border border-line p-3" onSubmit={(e) => {
      e.preventDefault(); setError(null);
      start(async () => {
        const result = await updateReceiptTaxAction({ receiptTaxId, purchaseOrderId, expectedRevisionAt: revisionAt, taxAnswer: answer, sellerTax: tax, otherState: state });
        if (result.status === "error") setError(result.message); else router.refresh();
      });
    }}>
      <Select id={`rt-${receiptTaxId}`} label="Did the seller charge sales tax?" value={answer} onChange={(e) => setAnswer(e.target.value)} required>
        <option value="" disabled>Choose one…</option>
        <option value="YES_COLORADO">Yes — Colorado sales tax</option>
        <option value="YES_OTHER_STATE">Yes — another state&apos;s tax</option>
        <option value="NO">No tax was charged</option>
        <option value="LATER">I&apos;ll check the receipt later</option>
      </Select>
      {taxed && <Field id={`rt-tax-${receiptTaxId}`} label="Total tax printed on the receipt ($)" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} required />}
      {answer === "YES_OTHER_STATE" && <Field id={`rt-state-${receiptTaxId}`} label="Which state?" value={state} onChange={(e) => setState(e.target.value)} required />}
      <Button type="submit" disabled={pending || !answer}>{pending ? "Saving…" : "Save tax answer"}</Button>
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}
    </form>
  );
}
