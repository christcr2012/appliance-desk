"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Select } from "@/components/ui";
import {
  addSalvagedPartsAction, completeRetiredPlanAction, reopenRetiredPlanAction, setRetiredPlanAction,
} from "../retired-actions";

type Choice = "SELL" | "STRIP" | "SCRAP" | "DISPOSE" | "OTHER";
const CHOICES: Array<{ value: Choice; label: string; help: string }> = [
  { value: "SELL", label: "Sell it", help: "Keep it to sell to a customer." },
  { value: "STRIP", label: "Strip it for parts", help: "Take the working parts for your shelf, then scrap or throw away the rest." },
  { value: "SCRAP", label: "Scrap it", help: "It goes to a scrap yard." },
  { value: "DISPOSE", label: "Throw it away", help: "It goes to the dump." },
  { value: "OTHER", label: "Donate or something else", help: "Add a short note about what happens to it." },
];

export type PlanPanelProps = {
  applianceId: string;
  plan: { choice: Choice; note: string | null; remainder: string | null; doneOn: string | null; doneNote: string | null; reopenReason: string | null } | null;
  salvaged: Array<{ id: string; label: string; quantity: number }>;
  parts: Array<{ id: string; label: string }>;
  today: string;
  isOwner: boolean;
};

/** "What's next for it?" for a retired appliance (Batch M-2). Nothing here books money. */
export function RetiredPlanPanel({ applianceId, plan, salvaged, parts, today, isOwner }: PlanPanelProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice | "">(plan?.choice ?? "");
  const [note, setNote] = useState(plan?.note ?? "");
  const [doneOn, setDoneOn] = useState(today);
  const [doneNote, setDoneNote] = useState("");
  const [remainder, setRemainder] = useState<"" | "SCRAPPED" | "THROWN_AWAY">("");
  const [reopenReason, setReopenReason] = useState("");
  const [reopening, setReopening] = useState(false);
  const [rows, setRows] = useState<Array<{ key: number; partId: string; modelNumber: string; partNumber: string; partName: string; quantity: string }>>([
    { key: 0, partId: "", modelNumber: "", partNumber: "", partName: "", quantity: "1" },
  ]);
  const nextKey = useRef(1);
  // One identity per screen load of the "add parts" form, so a double tap cannot add the parts twice.
  const salvageKey = useRef(`salvage-${crypto.randomUUID()}`);

  function run(task: () => Promise<{ status: string; message?: string }>) {
    setError(null);
    start(async () => {
      const result = await task();
      if (result.status === "error") return setError(result.message ?? "Something went wrong.");
      router.refresh();
    });
  }

  const done = plan?.doneOn != null;
  const planLabel = CHOICES.find((c) => c.value === plan?.choice)?.label;

  return (
    <Card>
      <h2 className="text-lg font-semibold">What&apos;s next for it?</h2>
      <p className="mt-1 text-sm text-ink-soft">
        This appliance is retired, so it can&apos;t be rented. Choose what happens to it. This is a note to yourself and does not change your books.
      </p>

      {done ? (
        <div className="mt-4 space-y-2 text-sm">
          <p><span className="font-semibold">{planLabel}</span> — done on {plan?.doneOn}{plan?.doneNote ? ` · ${plan.doneNote}` : ""}</p>
          {plan?.remainder && <p>The rest was {plan.remainder === "SCRAPPED" ? "scrapped" : "thrown away"}.</p>}
          {isOwner && !reopening && <Button type="button" variant="secondary" onClick={() => setReopening(true)}>Reopen…</Button>}
          {isOwner && reopening && (
            <form className="grid gap-2 sm:max-w-md" onSubmit={(e) => { e.preventDefault(); run(() => reopenRetiredPlanAction(applianceId, reopenReason)); }}>
              <Field id="reopen-reason" label="Why is it being reopened?" value={reopenReason} onChange={(e) => setReopenReason(e.target.value)} maxLength={200} required />
              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>Reopen</Button>
                <Button type="button" variant="secondary" onClick={() => setReopening(false)}>Never mind</Button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <>
          <form className="mt-4 grid gap-3 sm:max-w-xl" onSubmit={(e) => { e.preventDefault(); run(() => setRetiredPlanAction(applianceId, { choice: choice || null, note })); }}>
            <fieldset className="grid gap-2">
              <legend className="text-sm font-semibold">Choose one</legend>
              {CHOICES.map((c) => (
                <label key={c.value} className="flex min-h-11 items-start gap-3 rounded-control border border-line p-3 text-sm">
                  <input type="radio" name="retired-choice" value={c.value} checked={choice === c.value} onChange={() => setChoice(c.value)} className="mt-1" />
                  <span><span className="block font-semibold">{c.label}</span><span className="text-ink-soft">{c.help}</span></span>
                </label>
              ))}
              <label className="flex min-h-11 items-start gap-3 rounded-control border border-line p-3 text-sm">
                <input type="radio" name="retired-choice" value="" checked={choice === ""} onChange={() => setChoice("")} className="mt-1" />
                <span><span className="block font-semibold">Decide later</span><span className="text-ink-soft">Nothing is lost; you&apos;ll get one reminder on Today if it waits too long.</span></span>
              </label>
            </fieldset>
            {choice === "OTHER" && <Field id="retired-note" label="What happens to it?" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} required />}
            <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save this choice"}</Button></div>
          </form>

          {plan?.choice === "STRIP" && (
            <div className="mt-6 space-y-4 border-t border-line pt-4">
              <h3 className="font-semibold">Parts taken from it</h3>
              {salvaged.length === 0 ? <p className="text-sm text-ink-soft">None yet.</p> : (
                <ul className="text-sm">{salvaged.map((s) => <li key={s.id}>{s.quantity} × {s.label}</li>)}</ul>
              )}
              <p className="text-sm text-ink-soft">Parts are added to your shelf at $0 each, because what they cost is already part of what you paid for the appliance.</p>
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  const lines = rows.filter((r) => r.partId || r.partNumber).map((r) =>
                    r.partId
                      ? { partRecordId: r.partId, quantity: Number(r.quantity) }
                      : { newPart: { modelNumber: r.modelNumber, partNumber: r.partNumber, partName: r.partName || undefined }, quantity: Number(r.quantity) });
                  run(async () => {
                    const r = await addSalvagedPartsAction(applianceId, { operationKey: salvageKey.current, lines });
                    if (r.status === "success") salvageKey.current = `salvage-${crypto.randomUUID()}`;
                    return r;
                  });
                }}
              >
                {rows.map((row, i) => (
                  <div key={row.key} className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-2">
                    <Select id={`salv-part-${row.key}`} label={`Part ${i + 1}`} value={row.partId} onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, partId: e.target.value } : r)))}>
                      <option value="">A new part (fill in below)</option>
                      {parts.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </Select>
                    <Field id={`salv-qty-${row.key}`} label="How many" type="number" min={1} max={100} value={row.quantity} onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, quantity: e.target.value } : r)))} />
                    {!row.partId && (
                      <>
                        <Field id={`salv-model-${row.key}`} label="Fits model" value={row.modelNumber} onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, modelNumber: e.target.value } : r)))} />
                        <Field id={`salv-number-${row.key}`} label="Part number" value={row.partNumber} onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, partNumber: e.target.value } : r)))} />
                        <Field id={`salv-name-${row.key}`} label="Part name (optional)" value={row.partName} onChange={(e) => setRows((c) => c.map((r) => (r.key === row.key ? { ...r, partName: e.target.value } : r)))} />
                      </>
                    )}
                  </div>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="secondary" onClick={() => setRows((c) => [...c, { key: nextKey.current++, partId: "", modelNumber: "", partNumber: "", partName: "", quantity: "1" }])}>Add another part</Button>
                  <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Add parts to stock"}</Button>
                </div>
              </form>
            </div>
          )}

          {plan && plan.choice !== "SELL" && (
            <form className="mt-6 grid gap-3 border-t border-line pt-4 sm:max-w-xl" onSubmit={(e) => { e.preventDefault(); run(() => completeRetiredPlanAction(applianceId, { doneOn, note: doneNote || undefined, remainder: remainder || undefined })); }}>
              <h3 className="font-semibold">Mark it done</h3>
              {plan.choice === "STRIP" && (
                <Select id="retired-remainder" label="What happened to the rest of it?" value={remainder} onChange={(e) => setRemainder(e.target.value as typeof remainder)} required>
                  <option value="">Choose…</option>
                  <option value="SCRAPPED">Scrapped</option>
                  <option value="THROWN_AWAY">Thrown away</option>
                </Select>
              )}
              <Field id="retired-done-on" label="Date it happened" type="date" value={doneOn} max={today} onChange={(e) => setDoneOn(e.target.value)} required />
              <Field id="retired-done-note" label="Note (optional)" value={doneNote} onChange={(e) => setDoneNote(e.target.value)} maxLength={300} />
              <div><Button type="submit" disabled={pending}>{pending ? "Saving…" : "Mark done"}</Button></div>
            </form>
          )}
          {plan?.choice === "SELL" && <p className="mt-4 text-sm text-ink-soft">A “Sell it” appliance is finished automatically when the sale is rung up.</p>}
        </>
      )}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-danger">{error}</p>}
    </Card>
  );
}
