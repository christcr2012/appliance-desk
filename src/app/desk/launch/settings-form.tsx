"use client";
import { useActionState } from "react";
import { saveLaunchSettings } from "./actions";
import type { LaunchFormState } from "@/domains/launch/schema";

export function LaunchSettingsForm({
  settings,
}: {
  settings: {
    prelaunchMode: boolean;
    emailEnabled: boolean;
    postalAddress: string;
    replyToEmail: string;
  };
}) {
  const [state, action, pending] = useActionState(saveLaunchSettings, {
    status: "idle",
  } as LaunchFormState);
  return (
    <form action={action} className="mt-4 max-w-xl space-y-4">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="prelaunchMode"
          defaultChecked={settings.prelaunchMode}
          className="mt-1"
        />
        <span>
          Prelaunch mode: show the launch homepage and accept interest-list
          signups. Turn off when you open; this also pauses the prelaunch
          emails.
        </span>
      </label>
      <div>
        <label htmlFor="postalAddress" className="block font-medium">
          Business mailing address for email footers
        </label>
        <textarea
          id="postalAddress"
          name="postalAddress"
          defaultValue={settings.postalAddress}
          maxLength={500}
          rows={3}
          className="mt-1 w-full rounded border border-line-strong bg-white p-2"
          aria-invalid={Boolean(state.errors?.postalAddress)}
          aria-describedby={
            state.errors?.postalAddress
              ? "address-help address-error"
              : "address-help"
          }
        />
        {state.errors?.postalAddress && (
          <p id="address-error" role="alert">
            {state.errors.postalAddress[0]}
          </p>
        )}
        <p id="address-help" className="mt-1 text-sm text-ink-soft">
          Use your valid business mailing address, registered PO box, or
          eligible private mailbox. This appears in every launch email.
        </p>
      </div>
      <div>
        <label htmlFor="replyToEmail" className="block font-medium">
          Monitored business reply email
        </label>
        <input
          id="replyToEmail"
          name="replyToEmail"
          type="email"
          maxLength={254}
          defaultValue={settings.replyToEmail}
          className="mt-1 w-full rounded border border-line-strong bg-white p-2"
          aria-invalid={Boolean(state.errors?.replyToEmail)}
          aria-describedby={
            state.errors?.replyToEmail ? "reply-error" : undefined
          }
        />
        {state.errors?.replyToEmail && (
          <p id="reply-error" role="alert">
            {state.errors.replyToEmail[0]}
          </p>
        )}
      </div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          name="emailEnabled"
          defaultChecked={settings.emailEnabled}
          className="mt-1"
        />
        <span>
          Enable the three-email welcome sequence for people who opted in. I
          have checked the address and reply inbox above. Production sends up to
          25 emails daily; previews never send.
        </span>
      </label>
      <p className="text-sm text-ink-soft">
        The first email goes out on the next daily run, then the next two follow
        at least 3 and 4 days later. Pausing retains signups. An email already
        being sent may still arrive.
      </p>
      {state.message && (
        <p role={state.status === "error" ? "alert" : "status"}>
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        className="rounded bg-action px-4 py-2 text-on-action disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save launch settings"}
      </button>
    </form>
  );
}
