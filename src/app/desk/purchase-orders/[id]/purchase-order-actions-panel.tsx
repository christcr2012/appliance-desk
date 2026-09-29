"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markPurchaseOrderOrderedAction,
  receivePurchaseOrderAction,
  cancelPurchaseOrderAction,
} from "../../purchasing-actions";

export function PurchaseOrderActionsPanel({
  purchaseOrderId,
  status,
}: {
  purchaseOrderId: string;
  status: "DRAFT" | "ORDERED";
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run(action: () => Promise<{ status: string; message?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.status === "error") {
        setError(result.message ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap gap-3">
        {status === "DRAFT" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => markPurchaseOrderOrderedAction(purchaseOrderId))}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Mark as ordered
          </button>
        )}
        {status === "ORDERED" && (
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(() => receivePurchaseOrderAction(purchaseOrderId))}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Mark as received
          </button>
        )}
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => cancelPurchaseOrderAction(purchaseOrderId))}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          Cancel order
        </button>
      </div>
      {status === "ORDERED" && (
        <p className="mt-2 text-xs text-gray-500">
          Marking as received adds every line&apos;s quantity onto its part&apos;s stock count.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
