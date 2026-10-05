"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPartUsageAction, reversePartMovementAction } from "../../purchasing-actions";

export type PartsUsedRow = { id: string; label: string; quantity: number; unitCostCents: number | null; reversed: boolean };

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * Parts used on a repair visit, taken from the parts list. Each entry lowers that part's stock and, when the
 * part has a known purchase price, adds to the repair cost. When parts are listed here, this list is the parts
 * cost for the job (a second hand-entered number would be counted twice, so it is not allowed).
 */
export function JobPartsUsed({
  jobId,
  rows,
  cost,
  partOptions,
}: {
  jobId: string;
  rows: PartsUsedRow[];
  cost: { source: "ITEMIZED" | "LEGACY" | "NONE"; cents: number | null; unknownCostLines: number };
  partOptions: { id: string; label: string; onHand: number }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [partId, setPartId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => `ui-${crypto.randomUUID()}`);

  function add(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!partId) {
      setError("Choose a part.");
      return;
    }
    startTransition(async () => {
      const result = await recordPartUsageAction(partId, Number(quantity), key, jobId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setKey(`ui-${crypto.randomUUID()}`);
      setPartId("");
      setQuantity("1");
      router.refresh();
    });
  }

  function undo(movementId: string) {
    setError(null);
    startTransition(async () => {
      const result = await reversePartMovementAction(movementId, `ui-${crypto.randomUUID()}`, jobId);
      if (result.status === "error") setError(result.message);
      else router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium text-gray-900">Parts used on this visit</h2>
      <p className="mt-1 text-sm text-gray-600">
        Pick parts from your parts list. Each one comes off that part&apos;s stock, and its last known purchase price
        (an estimate) adds to this repair&apos;s cost. If you list parts here, the parts cost comes from this list.
      </p>
      {rows.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm text-gray-800">
          {rows.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-2">
              <span className={r.reversed ? "text-gray-500 line-through" : ""}>
                {r.quantity} × {r.label}
                {r.unitCostCents === null ? " — price not known" : ` — about ${money(r.unitCostCents)} each`}
              </span>
              {r.reversed ? (
                <span className="text-gray-500">(undone)</span>
              ) : (
                <button type="button" disabled={isPending} onClick={() => undo(r.id)} className="text-gray-700 underline disabled:opacity-50">
                  Undo
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-sm text-gray-700">
        {cost.source === "ITEMIZED"
          ? `Parts cost from this list: ${money(cost.cents ?? 0)}${cost.unknownCostLines > 0 ? ` (${cost.unknownCostLines} part${cost.unknownCostLines === 1 ? "" : "s"} without a price)` : ""}`
          : cost.source === "LEGACY"
            ? `Parts cost entered by hand: ${money(cost.cents ?? 0)}`
            : "No parts cost yet."}
      </p>
      <form onSubmit={add} className="mt-3 flex flex-wrap items-end gap-3">
        <div className="w-full min-w-0 sm:w-auto">
          <label htmlFor="jobPartId" className="block text-sm font-medium text-gray-700">
            Part
          </label>
          <select
            id="jobPartId"
            value={partId}
            onChange={(e) => setPartId(e.target.value)}
            className="mt-1 w-full max-w-full rounded-md sm:w-auto border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">Choose a part…</option>
            {partOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label} ({p.onHand} on hand)
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jobPartQty" className="block text-sm font-medium text-gray-700">
            How many
          </label>
          <input
            id="jobPartQty"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="mt-1 w-20 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <button type="submit" disabled={isPending} className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 disabled:opacity-50">
          Add
        </button>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
