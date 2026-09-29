"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPurchaseOrderAction } from "../../purchasing-actions";

type LineDraft = {
  partRecordId: string;
  description: string;
  quantity: string;
  unitCostDollars: string;
};

function emptyLine(): LineDraft {
  return { partRecordId: "", description: "", quantity: "1", unitCostDollars: "" };
}

export function NewPurchaseOrderForm({
  suppliers,
  partRecords,
}: {
  suppliers: { id: string; name: string }[];
  partRecords: { id: string; label: string }[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [error, setError] = useState<string | null>(null);

  function updateLine(index: number, patch: Partial<LineDraft>) {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createPurchaseOrderAction({
        supplierId,
        notes,
        lines: lines.map((l) => ({
          partRecordId: l.partRecordId || undefined,
          description: l.description,
          quantity: l.quantity,
          unitCostDollars: l.unitCostDollars || undefined,
        })),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      if (result.status === "success" && result.id) {
        router.push(`/desk/purchase-orders/${result.id}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-lg border border-gray-200 bg-white p-5">
      <div>
        <label htmlFor="po-supplier" className="block text-sm font-medium text-gray-700">
          Supplier
        </label>
        <select
          id="po-supplier"
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        >
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-sm font-medium text-gray-700">Lines</p>
        <div className="mt-2 space-y-3">
          {lines.map((line, i) => (
            <div key={i} className="rounded-md border border-gray-200 p-3">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div>
                  <label className="block text-xs text-gray-600">Part on file (optional)</label>
                  <select
                    value={line.partRecordId}
                    onChange={(e) => updateLine(i, { partRecordId: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">— Not in the parts catalog —</option>
                    {partRecords.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600">Description</label>
                  <input
                    type="text"
                    required
                    value={line.description}
                    onChange={(e) => updateLine(i, { description: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <div>
                  <label className="block text-xs text-gray-600">Quantity</label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-600">Unit cost ($)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={line.unitCostDollars}
                    onChange={(e) => updateLine(i, { unitCostDollars: e.target.value })}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  />
                </div>
                <div className="flex items-end">
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-sm text-red-700 hover:underline"
                    >
                      Remove line
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setLines((prev) => [...prev, emptyLine()])}
          className="mt-2 text-sm text-gray-700 underline"
        >
          + Add another line
        </button>
      </div>

      <div>
        <label htmlFor="po-notes" className="block text-sm font-medium text-gray-700">
          Notes
        </label>
        <textarea
          id="po-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Creating…" : "Create purchase order"}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
