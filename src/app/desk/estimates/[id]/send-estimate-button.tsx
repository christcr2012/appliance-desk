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
  const [sent, setSent] = useState<null | { emailed: boolean }>(null);

  if (sent) {
    return sent.emailed ? (
      <p className="text-sm text-green-700">Sent — the customer has been emailed a link.</p>
    ) : (
      <p role="status" className="text-sm text-gray-900">
        Marked as sent, but no email went out because customer email is turned off (Settings → Notifications).
        Share this link with the customer yourself: <span className="font-mono">/estimate/{estimateId}</span> on your website.
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
              setSent({ emailed: result.emailed === true });
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
