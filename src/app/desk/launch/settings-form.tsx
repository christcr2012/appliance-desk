"use client";

import { useActionState } from "react";
import { Button, Checkbox, Field, Textarea } from "@/components/ui";
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
      <Checkbox
        name="prelaunchMode"
        defaultChecked={settings.prelaunchMode}
        label="Prelaunch mode: show the launch homepage and accept interest-list signups."
        help="Turn this off when you open; turning it off also pauses the prelaunch emails."
      />

      <Textarea
        id="postalAddress"
        name="postalAddress"
        label="Business mailing address for email footers"
        help="Use your valid business mailing address, registered PO box, or eligible private mailbox. This appears in every launch email."
        error={state.errors?.postalAddress?.[0]}
        defaultValue={settings.postalAddress}
        maxLength={500}
        rows={3}
      />

      <Field
        id="replyToEmail"
        name="replyToEmail"
        label="Monitored business reply email"
        type="email"
        maxLength={254}
        error={state.errors?.replyToEmail?.[0]}
        defaultValue={settings.replyToEmail}
      />

      <Checkbox
        name="emailEnabled"
        defaultChecked={settings.emailEnabled}
        label="Enable the three-email welcome sequence for people who opted in."
        help="I have checked the mailing address and reply inbox above. Production sends up to 25 emails daily; previews never send."
      />

      <p className="text-sm text-ink-soft">
        The first email goes out on the next daily run, then the next two
        follow at least 3 and 4 days later. Pausing retains signups. An email
        already being sent may still arrive.
      </p>

      {state.message && (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-3 py-2 text-sm font-medium ${
            state.status === "error" ? "text-danger" : "text-success"
          }`}
        >
          {state.message}
        </p>
      )}

      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save launch settings"}
      </Button>
    </form>
  );
}
