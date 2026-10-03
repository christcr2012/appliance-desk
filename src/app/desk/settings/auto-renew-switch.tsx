"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setAutoRenewAction } from "./actions";

export function AutoRenewSwitch({ enabled, canChange }: { enabled: boolean; canChange: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function change(next: boolean) {
    const ok = window.confirm(
      next
        ? "Turn ON automatic renewals?\n\nCustomers who agreed to renew automatically will have a month-to-month renewal queued, get a reminder, and keep being billed after their term ends."
        : "Turn OFF automatic renewals?\n\nNothing new is queued or started automatically. Customers can still turn it off, and early endings still work.",
    );
    if (!ok) return;
    setError(null);
    startTransition(async () => {
      const result = await setAutoRenewAction(next);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="max-w-2xl space-y-3 rounded-lg border border-gray-300 p-4 text-sm text-ink">
      <p>
        <span className="font-medium">Automatic renewals:</span>{" "}
        <span className={enabled ? "font-semibold text-green-800" : "font-semibold"}>{enabled ? "ON" : "OFF"}</span>
      </p>
      <p className="text-ink-soft">
        <strong>What it does.</strong> When ON, a customer who agreed to renew automatically gets a month-to-month
        renewal queued near the end of their term, a reminder before it, and keeps being billed afterward. When OFF,
        none of that happens by itself, even for customers who agreed when they signed. Their rental simply ends on its
        end date unless you handle it by hand.
      </p>
      <p className="text-ink-soft">
        <strong>Starting value: OFF.</strong> There are known gaps still to be built before this is safe for real
        customers (see the go-live checklist). Turning it OFF never blocks a customer from turning auto-renew off or
        from an early ending.
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
          {pending ? "Saving…" : enabled ? "Turn OFF automatic renewals" : "Turn ON automatic renewals"}
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
