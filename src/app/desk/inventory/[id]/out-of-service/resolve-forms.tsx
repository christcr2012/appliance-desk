"use client";

import { useState, useTransition } from "react";
import { Button, Field } from "@/components/ui";
import { resolveOutOfServiceAction, type ResolveState } from "./actions";

export function ResolveForms({ applianceId, startedOnKey, todayKey }: { applianceId: string; startedOnKey: string; todayKey: string }) {
  const [backOn, setBackOn] = useState(todayKey);
  const [closeOn, setCloseOn] = useState(todayKey);
  const [state, setState] = useState<ResolveState>({ status: "idle" });
  const [isPending, startTransition] = useTransition();
  const run = (how: "SAME_MACHINE_BACK" | "CLOSED_BY_OWNER", date: string) =>
    startTransition(async () => {
      try {
        setState(await resolveOutOfServiceAction(applianceId, how, date));
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
      {state.status === "error" && <p role="alert" className="text-sm font-medium text-danger sm:col-span-2">{state.message}</p>}
    </div>
  );
}
