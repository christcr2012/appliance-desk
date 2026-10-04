"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  markPurchaseOrderOrderedAction,
  receivePurchaseOrderLinesAction,
  cancelPurchaseOrderAction,
} from "../../purchasing-actions";

export type ReceivableLine = {
  id: string;
  description: string;
  outstanding: number;
  unitCostKnown: boolean;
  unitCostCents: number;
  hasPart: boolean;
};

export function PurchaseOrderActionsPanel({
  purchaseOrderId,
  status,
  lines = [],
}: {
  purchaseOrderId: string;
  status: "DRAFT" | "ORDERED";
  lines?: ReceivableLine[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // One identity for this form: pressing the button twice, or retrying after a lost connection, records the delivery once.
  const [operationKey, setOperationKey] = useState(() => `ui-${crypto.randomUUID()}`);
  const open = lines.filter((l) => l.outstanding > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((l) => [l.id, String(l.outstanding)])),
  );
  const [prices, setPrices] = useState<Record<string, string>>({});

  function receive() {
    setError(null);
    const chosen = open
      .map((l) => ({ line: l, quantity: Number(quantities[l.id] ?? "0") }))
      .filter((x) => Number.isFinite(x.quantity) && x.quantity > 0);
    if (chosen.length === 0) {
      setError("Enter how many arrived on at least one line.");
      return;
    }
    startTransition(async () => {
      const result = await receivePurchaseOrderLinesAction({
        purchaseOrderId,
        operationKey,
        lines: chosen.map((x) => ({
          lineId: x.line.id,
          quantity: x.quantity,
          unitCostDollars: (prices[x.line.id] ?? "").trim() || undefined,
        })),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOperationKey(`ui-${crypto.randomUUID()}`);
      router.refresh();
    });
  }

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
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(() => cancelPurchaseOrderAction(purchaseOrderId))}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          Cancel order
        </button>
      </div>
      {status === "ORDERED" && open.length > 0 && (
        <fieldset className="mt-4 space-y-3 border-t border-gray-100 pt-4">
          <legend className="text-sm font-medium text-gray-900">What arrived</legend>
          <p className="text-xs text-gray-600">
            Enter how many of each item arrived in this delivery. If only part of the order came, enter what came and
            come back when the rest arrives. Leave a price blank to keep the ordered price (or leave it unknown).
            Items tied to a part are added to that part&apos;s stock.
          </p>
          {open.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="min-w-40 flex-1 text-gray-900">
                {l.description} <span className="text-gray-500">({l.outstanding} still to arrive)</span>
              </span>
              <label className="flex items-center gap-1 text-gray-700">
                <span>Arrived</span>
                <input
                  type="number"
                  min={0}
                  max={l.outstanding}
                  value={quantities[l.id] ?? ""}
                  onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))}
                  className="w-20 rounded-md border border-gray-300 px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1 text-gray-700">
                <span>Price each $</span>
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder={l.unitCostKnown ? (l.unitCostCents / 100).toFixed(2) : "unknown"}
                  value={prices[l.id] ?? ""}
                  onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))}
                  className="w-24 rounded-md border border-gray-300 px-2 py-1"
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            disabled={isPending}
            onClick={receive}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            Record what arrived
          </button>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
