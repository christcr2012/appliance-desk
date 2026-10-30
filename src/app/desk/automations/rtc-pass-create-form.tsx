"use client";
import { useActionState } from "react";
import { createRtcPassAction } from "./rtc-pass-actions";

export function CreateRtcPassForm() {
  const [state, action, pending] = useActionState(createRtcPassAction, {
    secret: null, expiresAt: null, error: null,
  });
  return (
    <div className="min-w-0 max-w-full space-y-3">
      <form action={action} className="min-w-0 max-w-full space-y-3">
        <label className="block text-sm font-medium">Pass label
          <input name="label" minLength={3} maxLength={80} required
            placeholder="My toolkit connection"
            className="mt-1 block w-full min-w-0 max-w-full rounded-control border border-line-strong bg-surface p-2" />
        </label>
        <label className="block text-sm font-medium">Expires after
          <select name="days" defaultValue="1"
            className="mt-1 block w-full min-w-0 max-w-full rounded-control border border-line-strong bg-surface p-2">
            <option value="1">24 hours (recommended)</option>
            <option value="7">7 days</option>
            <option value="30">30 days (maximum)</option>
          </select>
        </label>
        <label className="block min-w-0 text-sm font-medium">Read access area
          <select name="area" defaultValue="all"
            className="mt-1 block w-full min-w-0 max-w-full rounded-control border border-line-strong bg-surface p-2">
            <option value="all">All allowed read-only areas</option>
            <option value="health">System health only</option>
            <option value="automation">Automation runs only</option>
            <option value="decisions">Decision status only</option>
            <option value="backup">Backup status only</option>
            <option value="feedback">Feedback reports only</option>
            <option value="repair">Repair cases only</option>
            <option value="optimization">Improvement observations only</option>
          </select>
        </label>
        <label className="flex min-w-0 items-start gap-2 text-sm">
          <input type="checkbox" name="decisionsRead" className="mt-1 shrink-0" />
          Also allow reading the status of business decisions (not their private answers)
        </label>
        <button type="submit" disabled={pending}
          className="min-h-11 rounded-control border border-line-strong px-3 py-2 disabled:opacity-50">
          {pending ? "Issuing..." : "Create read-only pass"}
        </button>
      </form>
      {state.error ? <p role="alert" className="text-sm text-ink-soft">{state.error}</p> : null}
      {state.secret ? (
        <div role="status" className="rounded-control border border-line p-3">
          <p className="font-medium">Copy this pass now. It will never be displayed again.</p>
          <p className="mt-2 break-all select-all rounded-control bg-surface-muted p-2 font-mono text-xs">
            {state.secret}
          </p>
          <p className="mt-2 text-sm text-ink-soft">Expires {state.expiresAt}.
            Do not paste the pass into a chat, URL, or support message.</p>
        </div>
      ) : null}
    </div>
  );
}
