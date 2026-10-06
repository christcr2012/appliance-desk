"use client";

import { useEffect, useState, useTransition } from "react";
import { payEstimateDepositAction, type EstimateResponseState } from "./actions";

/** Shown on an already-APPROVED estimate whose deposit hasn't been paid
 * yet — most commonly because the customer cancelled out of Stripe
 * Checkout the first time around (landed back on the cancel_url) and is
 * revisiting this same link. Lets them pick the deposit payment back up
 * without having to re-approve the estimate itself. */
export function PayDepositButton({ estimateId }: { estimateId: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<EstimateResponseState>({ status: "idle" });

  // See estimate-response-form.tsx's matching effect for why this is an
  // effect rather than a render-time assignment.
  useEffect(() => {
    if (result.status === "redirecting") {
      window.location.href = result.url;
    }
  }, [result]);

  if (result.status === "redirecting") {
    return <p className="mt-2 text-sm text-ink-soft">Taking you to a secure page to pay the deposit…</p>;
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          startTransition(async () => {
            setResult(await payEstimateDepositAction(estimateId));
          })
        }
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending ? "Starting…" : "Pay deposit"}
      </button>
      {result.status === "error" && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {result.message}
        </p>
      )}
    </div>
  );
}
