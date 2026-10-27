"use client";
import { useState, useTransition } from "react";
import { useActionState } from "react";
import {
  allowBankAutopayAction, approveAndSendAction, markBankHandledAction, saveAchWindowAction,
  type DisputeActionState,
} from "./actions";
import { MAX_ACH_DISPUTE_WINDOW_DAYS, MIN_ACH_DISPUTE_WINDOW_DAYS, RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS } from "@/domains/disputes/rules";

function Result({ state }: { state: DisputeActionState }) {
  if (state.status === "error") return <p role="alert" className="text-sm text-danger">{state.message}</p>;
  if (state.status === "success") return <p role="status" className="text-sm text-ink">{state.message}</p>;
  return null;
}

export function ApproveAndSend({ disputeId }: { disputeId: string }) {
  const [state, setState] = useState<DisputeActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  const sent = state.status === "success";
  return (
    <div className="space-y-2">
      {!sent && (
        <button
          type="button"
          disabled={pending}
          onClick={() => start(async () => setState(await approveAndSendAction(disputeId)))}
          className="min-h-11 rounded-control bg-brand px-4 font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Sending…" : "Approve and send to Stripe"}
        </button>
      )}
      <Result state={state} />
    </div>
  );
}

export function BankHandled({ disputeId }: { disputeId: string }) {
  const [note, setNote] = useState("");
  const [state, setState] = useState<DisputeActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <label className="grid gap-1 text-sm font-medium">
        How was it handled?
        <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} className="min-h-11 rounded-control border border-line p-2" />
      </label>
      <button type="button" disabled={pending} onClick={() => start(async () => setState(await markBankHandledAction(disputeId, note)))} className="min-h-11 rounded-control border border-line px-4 font-medium">
        Mark as handled
      </button>
      <Result state={state} />
    </div>
  );
}

export function AllowAutopay({ customerId, disputeId }: { customerId: string; disputeId: string }) {
  const [state, setState] = useState<DisputeActionState>({ status: "idle" });
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <button type="button" disabled={pending} onClick={() => start(async () => setState(await allowBankAutopayAction(customerId, disputeId)))} className="min-h-11 rounded-control border border-line px-4 font-medium">
        Allow bank autopay again
      </button>
      <Result state={state} />
    </div>
  );
}

export function AchWindowForm({ days, editable }: { days: number; editable: boolean }) {
  const [state, action, pending] = useActionState(saveAchWindowAction, { status: "idle" } as DisputeActionState);
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Starting value: {RECOMMENDED_ACH_DISPUTE_WINDOW_DAYS} days — not confirmed. A customer can ask their bank to reverse a bank debit for weeks, so a deposit refund waits this long first.
      </p>
      <form action={action} className="grid gap-3 md:max-w-sm">
        <label className="grid gap-1 text-sm font-medium">
          Days a bank deposit refund waits after the debit
          <input type="number" name="achDisputeWindowDays" min={MIN_ACH_DISPUTE_WINDOW_DAYS} max={MAX_ACH_DISPUTE_WINDOW_DAYS} defaultValue={days} required disabled={!editable} className="min-h-11 rounded-control border border-line p-2" />
        </label>
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
