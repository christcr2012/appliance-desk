"use client";

import { useState, useTransition } from "react";
import { Button, Field } from "@/components/ui";
import { markSetMachineDoneAction, resolveOutOfServiceAction, type ResolveState } from "./actions";

export function ResolveForms({
  applianceId,
  startedOnKey,
  todayKey,
  setDone,
}: {
  applianceId: string;
  startedOnKey: string;
  todayKey: string;
  /** Present when the machine is part of a set (W-21B); null for a machine alone on its line. */
  setDone: { summary: string } | null;
}) {
  const [doneOn, setDoneOn] = useState(startedOnKey);
  const [backOn, setBackOn] = useState(todayKey);
  const [closeOn, setCloseOn] = useState(todayKey);
  const [state, setState] = useState<ResolveState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const run = (how: "SAME_MACHINE_BACK" | "CLOSED_BY_OWNER" | "SET_DONE", date: string) =>
    startTransition(async () => {
      try {
        setState(how === "SET_DONE" ? await markSetMachineDoneAction(applianceId, date) : await resolveOutOfServiceAction(applianceId, how, date));
      } catch {
        setState({ status: "error", message: "The save was not confirmed. Reload to check before trying again." });
      }
    });

  if (state.status === "success") {
    return <p role="status" className="mt-6 font-medium text-success">{state.message}</p>;
  }
  return (
    <div className="mt-6 grid gap-6 sm:grid-cols-2">
      <form
        className="space-y-3 rounded-card border border-line p-4"
        onSubmit={(event) => {
          event.preventDefault();
          run("SAME_MACHINE_BACK", backOn);
        }}
      >
        <h3 className="font-semibold text-ink">The same machine is back</h3>
        <Field
          label="Date it was delivered back"
          type="date"
          min={startedOnKey}
          max={todayKey}
          value={backOn}
          onChange={(e) => setBackOn(e.target.value)}
          help="Marks it as with the customer again and credits the days without it."
          required
        />
        <Button type="submit" disabled={isPending}>Record it delivered back</Button>
      </form>
      <form
        className="space-y-3 rounded-card border border-line p-4"
        onSubmit={(event) => {
          event.preventDefault();
          run("CLOSED_BY_OWNER", closeOn);
        }}
      >
        <h3 className="font-semibold text-ink">Close without a replacement</h3>
        <Field
          label="Last day counted (the day after the last day without it)"
          type="date"
          min={startedOnKey}
          max={todayKey}
          value={closeOn}
          onChange={(e) => setCloseOn(e.target.value)}
          help="Credits the days from the pickup up to this date. Use it when you will not replace the machine; change the rental itself separately."
          required
        />
        <Button type="submit" variant="secondary" disabled={isPending}>Close and credit</Button>
      </form>
      {setDone && (
        <form
          className="space-y-3 rounded-card border border-line p-4 sm:col-span-2"
          onSubmit={(event) => {
            event.preventDefault();
            run("SET_DONE", doneOn);
          }}
        >
          <h3 className="font-semibold text-ink">The customer is done with it (part of a set)</h3>
          <p className="text-sm text-ink-soft">
            The machines that stay go to their normal single price, as agreed with you: “charged at the standard rate for
            one item, unless there is an exchange”. {setDone.summary}
          </p>
          <div className="max-w-xs">
            <Field
              label="Date the customer was done with it"
              type="date"
              min={startedOnKey}
              max={todayKey}
              value={doneOn}
              onChange={(e) => setDoneOn(e.target.value)}
              help="The pickup day if they gave it back for good; a later day if you decided later not to replace it."
              required
            />
          </div>
          <Button type="submit" variant="secondary" disabled={isPending}>Change to single prices</Button>
        </form>
      )}
      {state.status === "error" && <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">{state.message}</p>}
    </div>
  );
}
