"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/components/ui";
import {
  recordPartUsageAction,
  setPartArchivedAction,
  updatePartStockSettingsAction,
} from "../purchasing-actions";

function newOperationKey(): string {
  return `ui-${crypto.randomUUID()}`;
}

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
  const [settingsQuantity, setSettingsQuantity] = useState(
    String(quantityOnHand),
  );
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

  function handleUse(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const quantity = Number(useQuantity);
    startTransition(async () => {
      const result = await recordPartUsageAction(
        partRecordId,
        quantity,
        operationKey,
      );
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setMode("view");
      router.refresh();
    });
  }

  function handleSettings(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const quantity = Number(settingsQuantity);
    const threshold =
      settingsThreshold.trim() === "" ? null : Number(settingsThreshold);
    startTransition(async () => {
      const result = await updatePartStockSettingsAction(
        partRecordId,
        quantity,
        threshold,
        operationKey,
      );
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
      <form
        onSubmit={handleUse}
        className="grid gap-2 sm:grid-cols-[minmax(7rem,1fr)_auto_auto] sm:items-end"
      >
        <Field
          id={`use-${partRecordId}`}
          label="Used"
          type="number"
          min={1}
          value={useQuantity}
          onChange={(event) => setUseQuantity(event.target.value)}
        />
        <Button type="submit" disabled={isPending}>
          Save
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={isPending}
          onClick={() => setMode("view")}
        >
          Cancel
        </Button>
        {error && (
          <p role="alert" className="text-sm font-semibold text-danger sm:col-span-3">
            {error}
          </p>
        )}
      </form>
    );
  }

  if (mode === "settings") {
    return (
      <form
        onSubmit={handleSettings}
        className="grid gap-2 sm:grid-cols-2"
      >
        <Field
          id={`qty-${partRecordId}`}
          label="On hand"
          type="number"
          min={0}
          value={settingsQuantity}
          onChange={(event) => setSettingsQuantity(event.target.value)}
        />
        <Field
          id={`threshold-${partRecordId}`}
          label="Flag below"
          type="number"
          min={0}
          placeholder="none"
          value={settingsThreshold}
          onChange={(event) => setSettingsThreshold(event.target.value)}
        />
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <Button type="submit" disabled={isPending}>
            Save
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={isPending}
            onClick={() => setMode("view")}
          >
            Cancel
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm font-semibold text-danger sm:col-span-2">
            {error}
          </p>
        )}
      </form>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <p className={lowStock ? "font-semibold text-warning-ink" : "text-ink-soft"}>
        {quantityOnHand} on hand
        {reorderThreshold !== null && ` (flag at ${reorderThreshold})`}
        {lowStock && " — low stock"}
      </p>
      <div className="flex flex-wrap gap-2">
        {!archived && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOperationKey(newOperationKey());
              setError(null);
              setMode("use");
            }}
          >
            Used some
          </Button>
        )}
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setSettingsQuantity(String(quantityOnHand));
            setSettingsThreshold(
              reorderThreshold !== null ? String(reorderThreshold) : "",
            );
            setOperationKey(newOperationKey());
            setError(null);
            setMode("settings");
          }}
        >
          Edit stock
        </Button>
        <Button
          type="button"
          variant="quiet"
          disabled={isPending}
          onClick={handleArchive}
        >
          {archived ? "Restore" : "Archive"}
        </Button>
      </div>
      {error && (
        <p role="alert" className="font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
