"use client";

import { useState, useTransition } from "react";
import { sendEstimateAction } from "../actions";

export function SendEstimateButton({
  estimateId,
  hasLineItems,
}: {
  estimateId: string;
  hasLineItems: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<null | { emailed: boolean; outcome?: string }>(null);

  if (sent) {
    if (sent.emailed) {
      return <p className="text-sm text-green-700">Sent — the customer has been emailed a link.</p>;
    }
    return sent.outcome === "NOT_ATTEMPTED" ? (
      <p role="status" className="text-sm text-gray-900">
        Marked as sent, but no email went out because customer email is turned off (Settings → Notifications).
        Share this link with the customer yourself: <span className="font-mono">/estimate/{estimateId}</span> on your website.
      </p>
    ) : (
      <p role="status" className="text-sm text-gray-900">
        Marked as sent, but we could not confirm the email was delivered. It may or may not have gone out, so check
        with the customer before sending again. You can also share this link yourself:{" "}
        <span className="font-mono">/estimate/{estimateId}</span> on your website.
      </p>
    );
  }

  return (
    <div>
      <button
        type="button"
        disabled={isPending || !hasLineItems}
        onClick={() =>
          startTransition(async () => {
            setError(null);
            const result = await sendEstimateAction(estimateId);
            if (result.status === "error") {
              setError(result.message);
            } else {
              setSent({ emailed: result.emailed === true, outcome: result.outcome });
            }
          })
        }
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Sending…" : "Send to customer"}
      </button>
      {!hasLineItems && (
        <p className="mt-1 text-xs text-gray-500">Add at least one line item first.</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
