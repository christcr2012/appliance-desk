"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, Select } from "@/components/ui";
import { updatePurchaseTaxAction } from "../actions";

export function PurchaseTaxForm({
  purchaseId, revisionAt, initialAnswer, initialTax, initialState,
}: { purchaseId: string; revisionAt: string; initialAnswer: string; initialTax: string; initialState: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [answer, setAnswer] = useState(initialAnswer);
  const [tax, setTax] = useState(initialTax);
  const [state, setState] = useState(initialState);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const taxed = answer === "YES_COLORADO" || answer === "YES_OTHER_STATE";
  return (
    <form className="space-y-3" onSubmit={(e) => {
      e.preventDefault(); setMessage(null);
      start(async () => {
        const result = await updatePurchaseTaxAction({
          purchaseId, expectedTaxRevisionAt: revisionAt, taxAnswer: answer,
          sellerTax: taxed ? tax : "", otherState: answer === "YES_OTHER_STATE" ? state : "",
        });
        if (result.status === "error") setMessage({ ok: false, text: result.message });
        else { setMessage({ ok: true, text: "Tax answer saved." }); router.refresh(); }
      });
    }}>
      <Select id="taxAnswer" label="Did the seller charge sales tax?" value={answer} onChange={(e) => setAnswer(e.target.value)}>
        <option value="YES_COLORADO">Yes — Colorado sales tax</option>
        <option value="YES_OTHER_STATE">Yes — another state&apos;s tax</option>
        <option value="NO">No tax was charged</option>
        <option value="LATER">I&apos;ll check the receipt later</option>
      </Select>
      {taxed && <Field id="sellerTax" label="Tax printed on the receipt ($)" inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)} required />}
      {answer === "YES_OTHER_STATE" && <Field id="otherState" label="Which state?" value={state} onChange={(e) => setState(e.target.value)} required />}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save tax answer"}</Button>
      {message && <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold ${message.ok ? "text-success" : "text-danger"}`}>{message.text}</p>}
    </form>
  );
}
