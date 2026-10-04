"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordPartUsageAction, setPartArchivedAction, updatePartStockSettingsAction } from "../purchasing-actions";

/** A fresh identity for one save, created when a form opens: pressing Save twice or retrying changes nothing twice. */
function newOperationKey(): string {
  return `ui-${crypto.randomUUID()}`;
}

/** Small inline stock panel on a part row — shows the current count and
 * reorder threshold (if any), plus two quick actions: logging a used
 * quantity (recordPartUsage), and editing the count/threshold directly
 * (a recount, or setting a threshold for the first time). Deliberately
 * two separate, narrow actions rather than one big "edit everything"
 * form, since "I used some" is the everyday action and "fix the count /
 * set a threshold" is the occasional one. */
export function PartStockPanel({
  partRecordId,
  quantityOnHand,
  reorderThreshold,
  lowStock,
  archived = false,
}: {
  partRecordId: string;
  quantityOnHand: number;
  reorderThreshold: number | null;
  lowStock: boolean;
  archived?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<"view" | "use" | "settings">("view");
  const [useQuantity, setUseQuantity] = useState("1");
  const [settingsQuantity, setSettingsQuantity] = useState(String(quantityOnHand));
  const [settingsThreshold, setSettingsThreshold] = useState(
    reorderThreshold !== null ? String(reorderThreshold) : "",
  );
  const [error, setError] = useState<string | null>(null);
  const [operationKey, setOperationKey] = useState(newOperationKey);

  function handleArchive() {
    setError(null);
    startTransition(async () => {
      const result = await setPartArchivedAction(partRecordId, !archived);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.refresh();
    });
  }

  function handleUse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const quantity = Number(useQuantity);
    startTransition(async () => {
      const result = await recordPartUsageAction(partRecordId, quantity, operationKey);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setMode("view");
      router.refresh();
    });
  }

  function handleSettings(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const quantity = Number(settingsQuantity);
    const threshold = settingsThreshold.trim() === "" ? null : Number(settingsThreshold);
    startTransition(async () => {
      const result = await updatePartStockSettingsAction(partRecordId, quantity, threshold, operationKey);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setMode("view");
      router.refresh();
    });
  }

  if (mode === "use") {
    return (
      <form onSubmit={handleUse} className="mt-2 flex items-center gap-2 text-sm">
        <label htmlFor={`use-${partRecordId}`} className="text-gray-600">
          Used
        </label>
        <input
          id={`use-${partRecordId}`}
          type="number"
          min={1}
          value={useQuantity}
          onChange={(e) => setUseQuantity(e.target.value)}
          className="w-16 rounded-md border border-gray-300 px-2 py-1"
        />
        <button type="submit" disabled={isPending} className="text-gray-900 underline disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={() => setMode("view")} className="text-gray-500">
          Cancel
        </button>
        {error && <span role="alert" className="text-red-700">{error}</span>}
      </form>
    );
  }

  if (mode === "settings") {
    return (
      <form onSubmit={handleSettings} className="mt-2 flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor={`qty-${partRecordId}`} className="text-gray-600">
          On hand
        </label>
        <input
          id={`qty-${partRecordId}`}
          type="number"
          min={0}
          value={settingsQuantity}
          onChange={(e) => setSettingsQuantity(e.target.value)}
          className="w-16 rounded-md border border-gray-300 px-2 py-1"
        />
        <label htmlFor={`threshold-${partRecordId}`} className="text-gray-600">
          Flag below
        </label>
        <input
          id={`threshold-${partRecordId}`}
          type="number"
          min={0}
          placeholder="none"
          value={settingsThreshold}
          onChange={(e) => setSettingsThreshold(e.target.value)}
          className="w-20 rounded-md border border-gray-300 px-2 py-1"
        />
        <button type="submit" disabled={isPending} className="text-gray-900 underline disabled:opacity-50">
          Save
        </button>
        <button type="button" onClick={() => setMode("view")} className="text-gray-500">
          Cancel
        </button>
        {error && <span role="alert" className="text-red-700">{error}</span>}
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
      <span className={lowStock ? "font-medium text-amber-700" : "text-gray-600"}>
        {quantityOnHand} on hand
        {reorderThreshold !== null && ` (flag at ${reorderThreshold})`}
        {lowStock && " — low stock"}
      </span>
      {!archived && (
        <button type="button" onClick={() => {
          setOperationKey(newOperationKey());
          setError(null);
          setMode("use");
        }} className="text-gray-700 underline">
          Used some
        </button>
      )}
      <button type="button" onClick={() => {
        setSettingsQuantity(String(quantityOnHand));
        setSettingsThreshold(reorderThreshold !== null ? String(reorderThreshold) : "");
        setOperationKey(newOperationKey());
        setError(null);
        setMode("settings");
      }} className="text-gray-700 underline">
        Edit stock
      </button>
      <button type="button" disabled={isPending} onClick={handleArchive} className="text-gray-700 underline disabled:opacity-50">
        {archived ? "Restore" : "Archive"}
      </button>
      {error && <span role="alert" className="text-red-700">{error}</span>}
    </div>
  );
}
