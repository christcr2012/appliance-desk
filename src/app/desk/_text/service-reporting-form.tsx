"use client";

import { useActionState } from "react";
import { saveServiceReportingAction, type TextActionState } from "./actions";

export function ServiceReportingForm({ scenarios, minDays, minSample, version, isRecommended }: {
  scenarios: readonly number[]; minDays: number; minSample: number; version: number; isRecommended: boolean;
}) {
  const [state, act, pending] = useActionState<TextActionState, FormData>(saveServiceReportingAction, null);
  return <form action={act} className="mt-2 space-y-2">
    <input type="hidden" name="version" value={version} />
    <label className="block text-sm">Customer counts for the what-if forecast (up to 6, separated by commas)
      <input name="scenarios" defaultValue={scenarios.join(", ")} className="mt-1 block w-full max-w-sm rounded border border-line p-1" /></label>
    <label className="block text-sm">Customer-days of history needed before a forecast is shown
      <input name="minDays" type="number" min={1} max={3650} defaultValue={minDays} className="ml-2 w-24 rounded border border-line p-1" /></label>
    <label className="block text-sm">Fewest texts (or people) needed before a rate is shown
      <input name="minSample" type="number" min={1} max={10000} defaultValue={minSample} className="ml-2 w-24 rounded border border-line p-1" /></label>
    <p className="text-xs text-ink-soft">{isRecommended ? "These are the recommended starting values." : "You changed these from the recommended values (200, 250, 500, 1,000 customers; 14 customer-days; 10)."}</p>
    <div className="flex gap-2">
      <button disabled={pending} className="rounded border border-line px-3 py-1 text-sm">Save</button>
      <button disabled={pending} name="restore" value="yes" className="rounded border border-line px-3 py-1 text-sm">Restore recommended</button>
    </div>
    {state && <p role="status" className="text-sm">{state.message}</p>}
  </form>;
}
