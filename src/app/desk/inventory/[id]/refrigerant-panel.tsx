"use client";
import { useActionState } from "react";
import Link from "next/link";
import { keepReceiptAction, saveRefrigerantAction, type RefrigerantActionState } from "./refrigerant-actions";
import { OUTCOME_LABELS, REFRIGERANT_TYPES } from "@/domains/refrigerant/rules";

export type RefrigerantPanelProps = {
  applianceId: string;
  today: string;
  locked: boolean;
  keepYears: number;
  keepUntilText: string | null;
  isOwner: boolean;
  receiptRecord: null | { id: string; fileCount: number };
  record: null | {
    refrigerantType: string; outcome: "RECOVERED" | "LEAKED_BEFORE"; recoveredByName: string; recoveredByAddress: string;
    certificationNumber: string | null; equipmentUsed: string | null; recoveredOn: string; recyclerName: string | null; receiptReference: string | null;
  };
};

function Input({ label, name, defaultValue, required = false, type = "text", max }: { label: string; name: string; defaultValue?: string; required?: boolean; type?: string; max?: number }) {
  return (
    <label className="grid gap-1 text-sm font-medium">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} required={required} maxLength={max} className="min-h-11 rounded-control border border-line p-2" />
    </label>
  );
}

/** "Refrigerant record" for a retired fridge or freezer that is being scrapped or thrown away. */
export function RefrigerantPanel({ applianceId, today, locked, keepYears, keepUntilText, isOwner, receiptRecord, record }: RefrigerantPanelProps) {
  const [state, action, pending] = useActionState(saveRefrigerantAction.bind(null, applianceId), { status: "idle" } as RefrigerantActionState);
  const saved = record !== null;
  const [receiptState, receiptAction, receiptPending] = useActionState(keepReceiptAction.bind(null, applianceId), { status: "idle" } as RefrigerantActionState);
  return (
    <section className="rounded-card border border-line bg-surface p-5" aria-labelledby="refrigerant-heading">
      <h2 id="refrigerant-heading" className="text-lg font-semibold">Refrigerant record</h2>
      <p className="mt-1 text-sm text-ink-soft">
        A scrap yard needs a signed statement that the refrigerant was removed (or had already leaked) before it will take a refrigerator or freezer. Record it here before you mark this one done.
        We keep the record for {keepYears} years (starting value, not confirmed).
      </p>
      {saved ? (
        <div className="mt-3 space-y-2 text-sm">
          <p className="font-semibold">Signed. {record.refrigerantType} — {record.outcome === "RECOVERED" ? `recovered by ${record.recoveredByName}` : "had already leaked"} on {record.recoveredOn}.</p>
          {keepUntilText ? <p className="text-ink-soft">Keep until {keepUntilText}.</p> : null}
          <a className="inline-block min-h-11 font-semibold underline" href={`/desk/inventory/${applianceId}/refrigerant-statement`} target="_blank" rel="noopener noreferrer">Print the statement for the scrap yard (PDF)</a>
          {receiptRecord ? (
            <p>Recycler&apos;s receipt: {receiptRecord.fileCount > 0 ? `${receiptRecord.fileCount} file${receiptRecord.fileCount === 1 ? "" : "s"} kept privately` : "no file uploaded yet"}. <Link className="underline" href={`/desk/paperwork/${receiptRecord.id}`}>Open the receipt record</Link> to {receiptRecord.fileCount > 0 ? "add another file" : "upload the photo or PDF"}.</p>
          ) : isOwner ? (
            <form action={receiptAction}>
              <button type="submit" disabled={receiptPending} className="min-h-11 rounded-control border border-line px-4 font-medium disabled:opacity-60">{receiptPending ? "Working…" : "Keep the recycler's receipt photo with my business records"}</button>
              {receiptState.status === "error" ? <p role="alert" className="text-sm text-danger">{receiptState.message}</p> : null}
              {receiptState.status === "success" ? <p role="status" className="text-sm text-ink">{receiptState.message}</p> : null}
            </form>
          ) : null}
        </div>
      ) : null}
      {!locked ? (
        <form action={action} className="mt-4 grid gap-3 sm:max-w-xl">
          <label className="grid gap-1 text-sm font-medium">
            Refrigerant type (from the nameplate)
            <select name="refrigerantType" required defaultValue={record?.refrigerantType ?? ""} className="min-h-11 rounded-control border border-line p-2">
              <option value="" disabled>Choose…</option>
              {REFRIGERANT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          <fieldset className="grid gap-2">
            <legend className="text-sm font-medium">What happened to it</legend>
            {(Object.keys(OUTCOME_LABELS) as Array<keyof typeof OUTCOME_LABELS>).map((k) => (
              <label key={k} className="flex min-h-11 items-start gap-3 text-sm">
                <input type="radio" name="outcome" value={k} required defaultChecked={record?.outcome === k} className="mt-1" />
                <span>{OUTCOME_LABELS[k]}</span>
              </label>
            ))}
          </fieldset>
          <Input label="Recovered by (person or shop), or your name if it had leaked" name="recoveredByName" defaultValue={record?.recoveredByName} required max={120} />
          <Input label="Their address" name="recoveredByAddress" defaultValue={record?.recoveredByAddress === "—" ? "" : record?.recoveredByAddress} max={200} />
          <Input label="Technician certification number (if any)" name="certificationNumber" defaultValue={record?.certificationNumber ?? ""} max={60} />
          <Input label="Equipment used (if any)" name="equipmentUsed" defaultValue={record?.equipmentUsed ?? ""} max={120} />
          <Input label="Date" name="recoveredOn" type="date" defaultValue={record?.recoveredOn ?? today} required />
          <Input label="Scrap yard or recycler (optional)" name="recyclerName" defaultValue={record?.recyclerName ?? ""} max={120} />
          <Input label="Their receipt number (optional)" name="receiptReference" defaultValue={record?.receiptReference ?? ""} max={120} />
          <label className="flex min-h-11 items-start gap-3 text-sm">
            <input type="checkbox" name="certify" className="mt-1 h-5 w-5" />
            <span>I am signing this statement for Robinson Appliance Rentals. The facts above are true.</span>
          </label>
          <div><button type="submit" disabled={pending} className="min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60">{pending ? "Saving…" : saved ? "Save changes" : "Sign and save"}</button></div>
          {state.status === "error" ? <p role="alert" className="text-sm text-danger">{state.message}</p> : null}
          {state.status === "success" ? <p role="status" className="text-sm text-ink">{state.message}</p> : null}
        </form>
      ) : <p className="mt-3 text-sm text-ink-soft">This appliance is marked done. Reopen it to change the record.</p>}
    </section>
  );
}
