"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { ApplianceStatus } from "@prisma/client";
import { ALL_APPLIANCE_STATUSES, APPLIANCE_STATUS_LABELS } from "@/domains/inventory/lifecycle";
import { bulkUpdateApplianceStatusAction } from "./actions";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

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

/** The inventory list's rows, with a checkbox-driven multi-select and
 * bulk "set status" bar (Task #44) — everything the plain server-
 * rendered list used to be, plus selection. Bulk status change reuses
 * bulkUpdateApplianceStatusAction, which applies to whatever in the
 * selection is actually a valid transition and reports what wasn't. */
export function InventoryList({ appliances }: { appliances: ApplianceRow[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkStatus, setBulkStatus] = useState<ApplianceStatus>("AVAILABLE");
  const [message, setMessage] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      prev.size === appliances.length ? new Set() : new Set(appliances.map((a) => a.id)),
    );
  }

  function handleApplyBulk() {
    setMessage(null);
    startTransition(async () => {
      const result = await bulkUpdateApplianceStatusAction([...selected], bulkStatus);
      if (result.status === "error") {
        setMessage(result.message);
        return;
      }
      const parts = [`Updated ${result.updatedCount}.`];
      if (result.skippedCount > 0) {
        parts.push(
          `Skipped ${result.skippedCount} (${result.skipMessage ?? "not a valid change for that unit"}).`,
        );
      }
      setMessage(parts.join(" "));
      setSelected(new Set());
      router.refresh();
    });
  }

  return (
    <div className="mt-6">
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-300 bg-gray-50 p-3 text-sm">
          <span className="font-medium text-gray-900">{selected.size} selected</span>
          <label htmlFor="bulkStatus" className="sr-only">
            Set status to
          </label>
          <select
            id="bulkStatus"
            value={bulkStatus}
            onChange={(e) => setBulkStatus(e.target.value as ApplianceStatus)}
            className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
          >
            {ALL_APPLIANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                Set to {APPLIANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={isPending}
            onClick={handleApplyBulk}
            className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Applying…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-gray-600 hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="mb-3 text-sm text-gray-700">
          {message}
        </p>
      )}

      <div className="rounded-lg border border-gray-200 bg-white">
        <label className="flex items-center gap-2 border-b border-gray-200 px-4 py-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={selected.size === appliances.length && appliances.length > 0}
            onChange={toggleAll}
          />
          Select all on this page
        </label>
        <ul className="divide-y divide-gray-200">
          {appliances.map((appliance) => (
            <li key={appliance.id} className="flex items-center gap-3 px-4 py-4 hover:bg-gray-50">
              <input
                type="checkbox"
                aria-label={`Select ${appliance.assetNumber}`}
                checked={selected.has(appliance.id)}
                onChange={() => toggle(appliance.id)}
              />
              <Link
                href={`/desk/inventory/${appliance.id}`}
                className="flex flex-1 flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {appliance.assetNumber} — {appliance.applianceType.name}
                  </p>
                  <p className="text-sm text-gray-600">
                    {[appliance.manufacturer, appliance.model, appliance.color]
                      .filter(Boolean)
                      .join(" ") || "No manufacturer/model on file"}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <StatusBadge
                    tone={STATUS_TONE[appliance.status]}
                    label={APPLIANCE_STATUS_LABELS[appliance.status]}
                  />
                  <p>{appliance.currentLocation ?? "No location on file"}</p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
