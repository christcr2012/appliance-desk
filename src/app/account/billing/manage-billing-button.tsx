"use client";

import { useState, useTransition } from "react";
import { openBillingPortalAction } from "./actions";

export function ManageBillingButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      // On success this never resolves here — the action itself redirects
      // the whole page to Stripe. It only resolves if there was nothing to
      // redirect to.
      const result = await openBillingPortalAction();
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending ? "Opening…" : "Manage payment method & billing"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-ink-soft">
          {error}
        </p>
      )}
    </div>
  );
}
