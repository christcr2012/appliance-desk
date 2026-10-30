"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateMaintenanceStatusAction } from "../actions";
import { StatusPill } from "@/components/kit";
import { REPAIR_PILL } from "@/domains/jobs/words";

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
  canScheduleJobs = false,
  nextVisitId = null,
}: {
  request: { id: string; status: MaintenanceStatusValue; customerId: string };
  canScheduleJobs?: boolean;
  /** The earliest booked visit for this request, for the SCHEDULED next step. */
  nextVisitId?: string | null;
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

  const pill = REPAIR_PILL[request.status];

  return (
    <div className="rounded-lg border border-line bg-white p-5">
      {/* AR-5 section 8: the one next step, performed right here. */}
      {request.status === "SUBMITTED" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-control bg-subtle px-3 py-2.5">
          <p className="text-sm font-medium text-ink">
            <span className="font-bold">Next step:</span> Look at this request.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleStatusChange("REVIEWING")}
            className="rounded-control bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Look at it
          </button>
          {canScheduleJobs && (
            <Link
              href={`/desk/jobs/new?maintenanceRequestId=${request.id}`}
              className="text-sm font-semibold text-ink underline underline-offset-4"
            >
              Schedule a visit
            </Link>
          )}
        </div>
      )}
      {request.status === "SCHEDULED" && nextVisitId && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-control bg-subtle px-3 py-2.5">
          <p className="text-sm font-medium text-ink">
            <span className="font-bold">Next step:</span> A visit is booked for this request.
          </p>
          <Link
            href={`/desk/jobs/${nextVisitId}`}
            className="rounded-control bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
          >
            Open the visit
          </Link>
        </div>
      )}
      {request.status === "RESOLVED" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-control bg-subtle px-3 py-2.5">
          <p className="text-sm font-medium text-ink">
            <span className="font-bold">Next step:</span> This is fixed — close the request out.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={() => handleStatusChange("CLOSED")}
            className="rounded-control bg-ink px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            Close it
          </button>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-medium text-ink">
          Status: <StatusPill label={pill.label} tone={pill.tone} />
        </h2>
        {canScheduleJobs && (
          <Link
            href={`/desk/jobs/new?maintenanceRequestId=${request.id}`}
            className="text-sm text-primary hover:underline"
          >
            + Schedule a job for this
          </Link>
        )}
      </div>

      {nextStatuses.length === 0 ? (
        <p className="mt-3 text-sm text-ink-soft">
          This request is closed out.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {ALL_STATUSES.filter((s) => nextStatuses.includes(s.value)).map(
            (s) => (
              <button
                key={s.value}
                type="button"
                disabled={isPending}
                onClick={() => handleStatusChange(s.value)}
                className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong disabled:opacity-50"
              >
                Mark {REPAIR_PILL[s.value].label}
              </button>
            ),
          )}
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
