"use client";

import type { ScheduleConflictView } from "./actions";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

const TYPE_LABEL: Record<string, string> = {
  DELIVERY: "Delivery",
  INSTALLATION: "Installation",
  SWAP: "Swap",
  MAINTENANCE_VISIT: "Maintenance visit",
  REMOVAL: "Removal",
};

/**
 * Shown when the chosen person already has another visit at that time. The person confirms this exact
 * list; if the schedule changes again before saving, a new list is shown and must be confirmed again.
 */
export function ScheduleConflictNotice({
  conflicts,
  onConfirm,
  disabled,
}: {
  conflicts: ScheduleConflictView[];
  onConfirm: (ids: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-medium">
        This person is already booked at that time{conflicts.length > 1 ? " for several visits" : ""}:
      </p>
      <ul className="mt-1 list-disc pl-5">
        {conflicts.map((c) => {
          const when = new Date(c.scheduledAt);
          return (
            <li key={c.jobId}>
              {TYPE_LABEL[c.type] ?? c.type}
              {c.customerName ? ` for ${c.customerName}` : ""} on {formatBusinessDate(when)} at {formatBusinessTime(when)}
              {c.durationMinutes ? ` (${c.durationMinutes} minutes)` : ""}
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={disabled}
        onClick={() => onConfirm(conflicts.map((c) => c.jobId))}
        className="mt-2 rounded-md border border-amber-700 px-3 py-1.5 text-sm font-medium text-amber-900 disabled:opacity-60"
      >
        Book it anyway
      </button>
    </div>
  );
}
