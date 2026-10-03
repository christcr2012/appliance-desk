"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setCustomerEmailAction } from "./actions";

export function CustomerEmailSwitch({
  enabled,
  canChange,
  preview,
}: {
  enabled: boolean;
  canChange: boolean;
  /** True on a preview or test copy of the site, where nothing is ever sent. */
  preview: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean) {
    const ok = window.confirm(
      next
        ? "Turn ON emails to customers?\n\nFrom now on the site will email real customers: renewal reminders, payment reminders, estimates and follow-ups, referral credit notices. Waiting reminders go out at the next nightly run."
        : "Turn OFF emails to customers?\n\nNothing will be emailed to customers. Reminders will wait on the Notices screen until you turn it back on or mark them delivered yourself.",
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await setCustomerEmailAction(next);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-3 text-sm text-ink">
      <p>
        <span className="font-medium">Send emails to customers:</span>{" "}
        <span className={enabled ? "font-semibold text-green-800" : "font-semibold"}>{enabled ? "ON" : "OFF"}</span>
      </p>
      <p className="text-ink-soft">
        <strong>What it does.</strong> When ON, the site emails real customers: the reminder before an automatic
        renewal, a heads-up before a monthly payment, estimates and estimate follow-ups, and referral credit notices.
        When OFF, none of those are sent; reminders simply wait on the Notices screen and nothing is lost.
      </p>
      <p className="text-ink-soft">
        <strong>Starting value: OFF</strong>, so nothing reaches a customer until you decide. Emails to you and your
        team (new lead alerts, backup problems) and sign-in emails are not affected by this switch.
      </p>
      <p className="text-ink-soft">
        <strong>Safety:</strong> preview and test copies of the site never send email, even if this is ON. It also
        needs the email service key to be set up (see the go-live checklist).
        {preview ? " This copy of the site is a preview, so nothing is sent from here." : ""}
      </p>
      <p className="text-ink-soft">
        <strong>Who can change it:</strong> only the owner.
      </p>
      {canChange ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => change(!enabled)}
          className="rounded-full bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? "Saving…" : enabled ? "Turn OFF customer emails" : "Turn ON customer emails"}
        </button>
      ) : (
        <p className="font-medium">Only the owner can change this.</p>
      )}
      {error && (
        <p role="alert" className="text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
