"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateMaintenanceStatusAction } from "../actions";

type MaintenanceStatusValue =
  | "SUBMITTED"
  | "REVIEWING"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "RESOLVED"
  | "CLOSED";

const ALL_STATUSES: { value: MaintenanceStatusValue; label: string }[] = [
  { value: "SUBMITTED", label: "Submitted" },
  { value: "REVIEWING", label: "Reviewing" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

// Mirrors ALLOWED_TRANSITIONS in src/domains/maintenance/index.ts — only
// to grey out invalid buttons; the real enforcement is server-side.
const ALLOWED_NEXT: Record<MaintenanceStatusValue, MaintenanceStatusValue[]> = {
  SUBMITTED: ["REVIEWING", "CLOSED"],
  REVIEWING: ["SCHEDULED", "CLOSED"],
  SCHEDULED: ["IN_PROGRESS", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "CLOSED"],
  RESOLVED: ["CLOSED"],
  CLOSED: [],
};

export function MaintenanceDetailPanel({
  request,
}: {
  request: { id: string; status: MaintenanceStatusValue; customerId: string };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const nextStatuses = ALLOWED_NEXT[request.status];

  function handleStatusChange(status: MaintenanceStatusValue) {
    setError(null);
    startTransition(async () => {
      const result = await updateMaintenanceStatusAction(request.id, status);
      if (result.status === "error") setError(result.message);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-medium text-gray-900">Status: {request.status}</h2>
        <Link
          href={`/desk/jobs/new?maintenanceRequestId=${request.id}`}
          className="text-sm text-primary hover:underline"
        >
          + Schedule a job for this
        </Link>
      </div>

      {nextStatuses.length === 0 ? (
        <p className="mt-3 text-sm text-gray-600">This request is closed out.</p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {ALL_STATUSES.filter((s) => nextStatuses.includes(s.value)).map((s) => (
            <button
              key={s.value}
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange(s.value)}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
            >
              Mark {s.label}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
