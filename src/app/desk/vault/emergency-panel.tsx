"use client";

import { useActionState, useState, useTransition } from "react";
import { Button, Checkbox, Field } from "@/components/ui";
import {
  createEmergencyLinkAction,
  denyEmergencyRequestAction,
  saveEmergencySettingsAction,
  type VaultFormState,
} from "./actions";
import type { EmergencyOwnerView } from "@/domains/vault/emergency";

const initial: VaultFormState = { status: "idle" };

const STATUS_WORDS: Record<string, string> = {
  LINK_READY: "Link created — your contact hasn't used it yet.",
  WAITING: "Your contact has asked for access. The wait is running — you can still deny it.",
  CODE_SENT: "The wait is over and a code was sent to your contact's saved details.",
  VERIFIED: "Your contact confirmed the code. Their one-time download is ready.",
  DENIED: "You denied the last request. Nothing was shared.",
  CONSUMED: "The export was downloaded. The link is finished, except that your contact can still pause automatic charges for 24 hours after confirming their code.",
};

/**
 * VAULT-2: emergency access, owner side. Ships switched off; the owner saves
 * a contact, turns it on, and hands the contact a one-time link. While a
 * request waits, the owner can deny it here (and gets email + text
 * reminders from the daily sweep).
 */
export function EmergencyPanel({ view }: { view: EmergencyOwnerView }) {
  const { settings, active } = view;
  const [state, formAction, pending] = useActionState(saveEmergencySettingsAction, initial);
  const [token, setToken] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  function createLink() {
    setLinkError(null);
    startTransition(async () => {
      const result = await createEmergencyLinkAction();
      if ("error" in result) setLinkError(result.error);
      else setToken(result.token);
    });
  }

  const linkUrl = token && typeof window !== "undefined" ? `${window.location.origin}/emergency/${token}` : null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-soft">
        Emergency access lets one person you trust get a read-only copy of your business records and logins if
        something happens to you. It is switched off until you turn it on. When your contact asks, a waiting
        period starts (you&apos;re told right away, halfway through, and a day before it ends), and you can deny
        the request at any time before they download. After the wait, they confirm a code sent to the contact
        details saved here — never to an address they type in — and get one download that works once.
      </p>
      <form action={formAction} className="space-y-4">
        <Checkbox
          label="Turn emergency access on"
          name="enabled"
          defaultChecked={settings.enabled}
          help="Leaving this off means the emergency link does nothing at all."
        />
        <Field label="Contact's name" name="contactName" defaultValue={settings.contactName} />
        <Field label="Contact's email" name="contactEmail" defaultValue={settings.contactEmail} help="The one-time code can be emailed here." />
        <Field label="Contact's phone" name="contactPhone" defaultValue={settings.contactPhone} help="The one-time code is texted here first when texting is set up." />
        <Field
          label="Waiting period (days)"
          name="waitDays"
          type="number"
          min={1}
          max={30}
          defaultValue={String(settings.waitDays)}
          help="Between 1 and 30 days. Longer is safer; the starting value is 7."
        />
        {state.status === "error" && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
        )}
        {state.status === "saved" && <p className="text-sm text-ink-soft">Saved.</p>}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save emergency settings"}
        </Button>
      </form>

      <div className="border-t border-line pt-4">
        {active && (
          <p className="mb-3 text-sm">
            <span className="font-semibold">Latest request:</span> {STATUS_WORDS[active.status] ?? active.status}
            {active.waitEndsAt && active.status === "WAITING" && (
              <> The wait ends {new Date(active.waitEndsAt).toLocaleString("en-US", { timeZone: "America/Denver" })}.</>
            )}
          </p>
        )}
        {active && active.startNoticeFailed && active.status === "WAITING" && (
          <p className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-900" role="alert">
            <span className="font-semibold">We could not reach you when this request started</span> — the warning
            email and text both failed. The app keeps retrying once a day. Check that the email and phone on your
            account are current, and if you do not know why this request was made, deny it below.
          </p>
        )}
        {settings.enabled ? (
          <div className="space-y-3">
            <Button type="button" variant="secondary" disabled={busy} onClick={createLink}>
              {busy ? "Creating…" : "Create a new emergency link"}
            </Button>
            <p className="text-sm text-ink-soft">
              Give the link to your contact yourself (in person is best). Creating a new link switches any older
              link off.
            </p>
            {linkError && (
              <p role="alert" className="text-sm font-semibold text-danger">{linkError}</p>
            )}
            {linkUrl && (
              <div className="rounded-control border border-line bg-subtle p-3">
                <p className="text-sm font-semibold">Your emergency link — shown once, so save it now:</p>
                <p className="mt-1 break-all font-mono text-sm">{linkUrl}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">Turn emergency access on and save the contact to create a link.</p>
        )}
        {active && (["WAITING", "CODE_SENT", "VERIFIED"].includes(active.status) || (active.status === "CONSUMED" && active.pauseOpen)) && (
          <form action={denyEmergencyRequestAction.bind(null, active.id)} className="mt-4">
            <Button type="submit" variant="danger">
              {active.status === "CONSUMED" ? "Close this link now" : "Deny this request"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
