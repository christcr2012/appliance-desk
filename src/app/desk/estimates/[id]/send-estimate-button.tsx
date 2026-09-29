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
  const [sent, setSent] = useState(false);

  if (sent) {
    return <p className="text-sm text-green-700">Sent — the customer has been emailed a link.</p>;
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
              setSent(true);
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
