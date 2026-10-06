"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApplianceStatus } from "@prisma/client";
import {
  ALL_APPLIANCE_STATUSES,
  APPLIANCE_STATUS_LABELS,
} from "@/domains/inventory/lifecycle";
import {
  Button,
  Checkbox,
  Select,
  StatusPill,
} from "@/components/ui";
import type { StatusTone } from "@/components/status-badge";
import { bulkUpdateApplianceStatusAction } from "./actions";

type ApplianceRow = {
  id: string;
  assetNumber: string;
  status: ApplianceStatus;
  manufacturer: string | null;
  model: string | null;
  color: string | null;
  currentLocation: string | null;
  applianceType: { name: string };
};

const STATUS_TONE: Record<ApplianceStatus, StatusTone> = {
  AVAILABLE: "success",
  RESERVED: "pending",
  RENTED: "progress",
  AWAITING_PICKUP: "pending",
  AWAITING_INSPECTION: "pending",
  MAINTENANCE: "attention",
  RETIRED: "stopped",
};

export function InventoryList({
  appliances,
  canManage = false,
}: {
  appliances: ApplianceRow[];
  canManage?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] =
    useState<ApplianceStatus>("AVAILABLE");
  const [message, setMessage] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<
    { applianceId: string; reason: string }[]
  >([]);

  function toggle(id: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((previous) =>
      previous.size === appliances.length
        ? new Set()
        : new Set(appliances.map((appliance) => appliance.id)),
    );
  }

  function handleApplyBulk() {
    setMessage(null);
    setSkipped([]);
    startTransition(async () => {
      let result;
      try {
        result = await bulkUpdateApplianceStatusAction(
          [...selected],
          bulkStatus,
        );
      } catch {
        setMessage(
          "The changes were not confirmed. Check the inventory before retrying; your selection is still here.",
        );
        return;
      }
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      setMessage(
        `Updated ${result.updated.length}. Skipped ${result.skipped.length}.`,
      );
      setSkipped(result.skipped);
      setSelected(
        new Set(result.skipped.map((item) => item.applianceId)),
      );
      router.refresh();
    });
  }

  return (
    <div className="mt-6 space-y-4">
      {canManage && (
        <Checkbox
          disabled={isPending}
          label="Select all on this page"
          checked={
            selected.size === appliances.length && appliances.length > 0
          }
          onChange={toggleAll}
        />
      )}

      {canManage && selected.size > 0 && (
        <div className="grid gap-3 rounded-card border border-line bg-subtle p-4 sm:grid-cols-[auto_minmax(12rem,1fr)_auto_auto] sm:items-end">
          <p className="self-center text-sm font-semibold text-ink">
            {selected.size} selected
          </p>
          <Select
            disabled={isPending}
            label="Set status to"
            value={bulkStatus}
            onChange={(event) =>
              setBulkStatus(event.target.value as ApplianceStatus)
            }
          >
            {ALL_APPLIANCE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {APPLIANCE_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
          <Button
            type="button"
            disabled={isPending}
            onClick={handleApplyBulk}
          >
            {isPending ? "Applying…" : "Apply"}
          </Button>
          <Button
            type="button"
            variant="quiet"
            disabled={isPending}
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </Button>
        </div>
      )}

      {message && (
        <div role="status" className="text-sm text-ink-soft">
          <p>{message}</p>
          {skipped.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {skipped.map((item) => (
                <li key={item.applianceId}>
                  <Link
                    href={`/desk/inventory/${item.applianceId}`}
                    className="font-medium text-ink underline-offset-4 hover:underline"
                  >
                    {appliances.find(
                      (appliance) => appliance.id === item.applianceId,
                    )?.assetNumber ?? item.applianceId}
                  </Link>
                  {": "}
                  {item.reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ul
        aria-label="Inventory"
        className="divide-y divide-line rounded-card border border-line bg-surface"
      >
        {appliances.map((appliance) => (
          <li
            key={appliance.id}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center"
          >
            {canManage && (
              <div className="shrink-0">
                <Checkbox
                  disabled={isPending}
                  label={`Select ${appliance.assetNumber}`}
                  checked={selected.has(appliance.id)}
                  onChange={() => toggle(appliance.id)}
                />
              </div>
            )}

            <Link
              href={`/desk/inventory/${appliance.id}`}
              className="min-w-0 flex-1 rounded-control p-1 hover:bg-subtle sm:grid sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4"
            >
              <div className="min-w-0">
                <p className="font-semibold text-ink">
                  {appliance.assetNumber} — {appliance.applianceType.name}
                </p>
                <p className="mt-1 text-sm text-ink-soft">
                  {[appliance.manufacturer, appliance.model, appliance.color]
                    .filter(Boolean)
                    .join(" ") || "No manufacturer/model on file"}
                </p>
              </div>

              <div className="mt-3 sm:mt-0">
                <StatusPill
                  tone={STATUS_TONE[appliance.status]}
                  label={APPLIANCE_STATUS_LABELS[appliance.status]}
                />
              </div>

              <p className="mt-2 text-sm text-ink-soft sm:mt-0 sm:text-right">
                {appliance.currentLocation ?? "No location on file"}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
