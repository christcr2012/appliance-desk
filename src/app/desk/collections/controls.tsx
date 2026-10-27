"use client";
import { useActionState, useState, useTransition } from "react";
import { ladderAction, wordingAction, type CollectionActionState } from "./actions";
import { RECOMMENDED_LADDER } from "@/domains/collections/rules";

type Run = (note: string) => Promise<CollectionActionState>;

export function Result({ state }: { state: CollectionActionState }) {
  if (state.status === "error") return <p role="alert" className="text-sm text-danger">{state.message}</p>;
  if (state.status === "success") return <p role="status" className="text-sm text-ink">{state.message}</p>;
  return null;
}

/** One button, optionally with a short required note beside it. */
export function NoteAction({ label, noteLabel, run, needsNote = false, secondary = false }: { label: string; noteLabel?: string; run: Run; needsNote?: boolean; secondary?: boolean }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<CollectionActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      {noteLabel ? (
        <label className="grid gap-1 text-sm font-medium">
          {noteLabel}
          <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="min-h-11 rounded-control border border-line p-2" />
        </label>
      ) : null}
      <button
        type="button"
        disabled={pending || (needsNote && !note.trim())}
        onClick={() => start(async () => setState(await run(note)))}
        className={secondary ? "min-h-11 rounded-control border border-line px-4 font-medium disabled:opacity-60" : "min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60"}
      >
        {pending ? "Working…" : label}
      </button>
      <Result state={state} />
    </div>
  );
}

export function CourtOrderForm({ run }: { run: (note: string, orderedOn: string) => Promise<CollectionActionState> }) {
  const [note, setNote] = useState("");
  const [date, setDate] = useState("");
  const [state, setState] = useState<CollectionActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-2 md:max-w-md">
      <label className="grid gap-1 text-sm font-medium">Court and case number<input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className="min-h-11 rounded-control border border-line p-2" /></label>
      <label className="grid gap-1 text-sm font-medium">Date of the order<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="min-h-11 rounded-control border border-line p-2" /></label>
      <button type="button" disabled={pending || !note.trim() || !date} onClick={() => start(async () => setState(await run(note, date)))} className="min-h-11 rounded-control border border-line px-4 font-medium disabled:opacity-60">Record court order</button>
      <Result state={state} />
    </div>
  );
}

export function FilingForm({ defaultAmount, defaultFee, run }: { defaultAmount: string; defaultFee: string; run: (input: { county: string; filedOn: string; amountDollars: string; feeDollars: string }) => Promise<CollectionActionState> }) {
  const [county, setCounty] = useState("Weld");
  const [filedOn, setFiledOn] = useState("");
  const [amount, setAmount] = useState(defaultAmount);
  const [fee, setFee] = useState(defaultFee);
  const [state, setState] = useState<CollectionActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  const input = "min-h-11 rounded-control border border-line p-2";
  return (
    <div className="grid gap-2 md:max-w-md">
      <label className="grid gap-1 text-sm font-medium">County you filed in<input value={county} onChange={(e) => setCounty(e.target.value)} className={input} /></label>
      <label className="grid gap-1 text-sm font-medium">Date you filed<input type="date" value={filedOn} onChange={(e) => setFiledOn(e.target.value)} className={input} /></label>
      <label className="grid gap-1 text-sm font-medium">Amount you claimed ($)<input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={input} /></label>
      <label className="grid gap-1 text-sm font-medium">Filing fee you paid ($)<input inputMode="decimal" value={fee} onChange={(e) => setFee(e.target.value)} className={input} /></label>
      <button type="button" disabled={pending || !county.trim() || !filedOn} onClick={() => start(async () => setState(await run({ county, filedOn, amountDollars: amount, feeDollars: fee })))} className="min-h-11 rounded-control border border-line px-4 font-medium disabled:opacity-60">I filed it — record it</button>
      <Result state={state} />
    </div>
  );
}

export function WordingForm({ payHowText, helpText, defaultPayHow, defaultHelp, editable }: { payHowText: string; helpText: string; defaultPayHow: string; defaultHelp: string; editable: boolean }) {
  const [state, action, pending] = useActionState(wordingAction, { status: "idle" } as CollectionActionState);
  const field = "min-h-24 rounded-control border border-line p-2";
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Two lines in every past-due notice are yours to change. Leave one empty to use the recommended text (starting value — not confirmed). Notices already written keep their words, and you read every notice before it goes. Don&apos;t promise ownership of the appliance or mention a collection agency.
      </p>
      <form action={action} className="grid gap-3 md:max-w-xl">
        <label className="grid gap-1 text-sm font-medium">How to pay
          <textarea name="payHowText" maxLength={600} defaultValue={payHowText} placeholder={defaultPayHow} disabled={!editable} className={field} />
        </label>
        <label className="grid gap-1 text-sm font-medium">If something has gone wrong (second notice)
          <textarea name="helpText" maxLength={600} defaultValue={helpText} placeholder={defaultHelp} disabled={!editable} className={field} />
        </label>
        <div className="flex flex-wrap gap-3">
          <button disabled={!editable || pending} type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Save wording</button>
          <button disabled={!editable || pending} name="operation" value="restore" formNoValidate type="submit" className="min-h-11 rounded-control border border-line px-4 text-sm">Restore recommended</button>
        </div>
      </form>
      <Result state={state} />
    </div>
  );
}

export function LadderForm({ secondNotice, finalNotice, decision, editable }: { secondNotice: number; finalNotice: number; decision: number; editable: boolean }) {
  const [state, action, pending] = useActionState(ladderAction, { status: "idle" } as CollectionActionState);
  const field = "min-h-11 rounded-control border border-line p-2";
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Starting values — not confirmed: second notice on day {RECOMMENDED_LADDER.secondNotice}, final notice on day {RECOMMENDED_LADDER.finalNotice}, and a decision for you on day {RECOMMENDED_LADDER.decision} after a bill&apos;s due date. Nothing is sent without your approval.
      </p>
      <form action={action} className="grid gap-3 md:max-w-sm">
        <label className="grid gap-1 text-sm font-medium">Second notice (days past due)<input type="number" name="secondNotice" min={2} max={120} defaultValue={secondNotice} disabled={!editable} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Final notice (days past due)<input type="number" name="finalNotice" min={2} max={120} defaultValue={finalNotice} disabled={!editable} className={field} /></label>
        <label className="grid gap-1 text-sm font-medium">Your decision (days past due)<input type="number" name="decision" min={2} max={120} defaultValue={decision} disabled={!editable} className={field} /></label>
        <div className="flex flex-wrap gap-3">
          <button disabled={!editable || pending} type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Save</button>
          <button disabled={!editable || pending} name="operation" value="restore" formNoValidate type="submit" className="min-h-11 rounded-control border border-line px-4 text-sm">Restore recommended</button>
        </div>
      </form>
      <Result state={state} />
      {!editable ? <p className="text-sm text-ink-soft">Only the owner can change this.</p> : null}
    </div>
  );
}
