"use client";

// AR-5 section 3: one visit row on the Board (day and agenda views, and the waiting list).
// The row body is a stretched link — on phones it opens the visit record, on desktop it opens
// the board's side panel (?open=). The actions menu and the Schedule sheet sit above the link.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ActionMenu, Sheet, StatusPill, toast } from "@/components/kit";
import { businessDateTimeFromLocal, formatBusinessTime, formatWeekdayDate } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import { visitPill } from "@/domains/jobs/words";
import { scheduleJobAction, type ScheduleConflictView } from "../jobs/actions";
import { ScheduleConflictNotice } from "../jobs/schedule-conflicts";

export type BoardRowJob = {
  id: string;
  type: string;
  status: "SCHEDULED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
  version: number;
  scheduledAt: string | null;
  /** Colorado clock time as YYYY-MM-DDTHH:mm, or "" when unscheduled. */
  scheduledAtLocal: string;
  durationMinutes: number | null;
  assignedToUserId: string | null;
  assignedLabel: string | null;
  customerName: string;
  customerPhone: string | null;
  hasCustomer: boolean;
  address: string | null;
  checklistDone: number;
  checklistTotal: number;
  noShowAt: string | null;
};

export function BoardRow({
  job,
  conflicted,
  defaultMinutes,
  members,
  canSchedule,
  canContact,
  openHref,
}: {
  job: BoardRowJob;
  conflicted: boolean;
  defaultMinutes: number;
  members: { id: string; label: string }[];
  canSchedule: boolean;
  canContact: boolean;
  openHref: string;
}) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [when, setWhen] = useState(job.scheduledAtLocal);
  const [durationText, setDurationText] = useState(job.durationMinutes ? String(job.durationMinutes) : "");
  const [assignee, setAssignee] = useState(job.assignedToUserId ?? "");
  const [conflicts, setConflicts] = useState<ScheduleConflictView[]>([]);
  const [error, setError] = useState<string | null>(null);

  const pill = visitPill({ status: job.status, noShowAt: job.noShowAt ? new Date(job.noShowAt) : null });
  const recordHref = `/desk/jobs/${job.id}`;

  function save(confirmed: string[]) {
    setError(null);
    const minutes = durationText.trim() === "" ? null : Number(durationText.trim());
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 15 || minutes > 720)) {
      setError("Visit length: enter a whole number of minutes between 15 and 720, or leave it blank.");
      return;
    }
    if (!when) {
      setError("Choose a date and time.");
      return;
    }
    startTransition(async () => {
      const result = await scheduleJobAction({
        jobId: job.id,
        expectedVersion: job.version,
        scheduledAt: when,
        durationMinutes: minutes,
        assignedToUserId: assignee || null,
        confirmedConflictJobIds: confirmed,
      });
      if (result.status === "conflict") {
        setConflicts(result.conflicts);
      } else if (result.status === "error") {
        setConflicts([]);
        setError(result.message);
      } else {
        const instant = businessDateTimeFromLocal(when);
        setConflicts([]);
        setSheetOpen(false);
        if (instant) {
          toast({ message: `Visit booked for ${formatWeekdayDate(instant)} at ${formatBusinessTime(instant)}` });
        } else {
          toast({ message: "Visit booked." });
        }
        router.refresh();
      }
    });
  }

  const menuItems = [
    { label: "Open the visit record", href: recordHref },
    ...(canSchedule
      ? [{ label: "Change time or person…", onSelect: () => setSheetOpen(true) }]
      : []),
    ...(canContact && job.hasCustomer
      ? [{ label: "Text the customer…", href: recordHref }]
      : []),
    ...(canContact && job.customerPhone
      ? [{ label: "Call the customer", href: `tel:${job.customerPhone}`, external: true }]
      : []),
  ];

  return (
    <li
      className={`relative flex flex-col gap-1 rounded-control border px-3 py-3 text-sm sm:flex-row sm:items-center sm:justify-between ${
        conflicted ? "border-warning-ink bg-warning-bg" : "border-line bg-surface"
      }`}
    >
      <Link
        href={recordHref}
        aria-label={`Open ${jobTypeLabel(job.type)} for ${job.customerName}`}
        className="absolute inset-0 rounded-control sm:hidden"
      />
      <Link
        href={openHref}
        aria-label={`Open ${jobTypeLabel(job.type)} for ${job.customerName}`}
        className="absolute inset-0 hidden rounded-control sm:block"
      />
      <div className="pointer-events-none min-w-0">
        <p className="flex flex-wrap items-center gap-2 font-medium text-ink">
          <span>
            {job.scheduledAt ? `${formatBusinessTime(new Date(job.scheduledAt))} — ` : ""}
            {jobTypeLabel(job.type)} — {job.customerName}
          </span>
          <StatusPill label={pill.label} tone={pill.tone} />
          {conflicted ? <StatusPill label="Double-booked" tone="attention" info="double-booked" /> : null}
        </p>
        <p className="text-ink-soft">{job.address ?? "No address on file"}</p>
        <p className="text-ink-soft">
          {job.assignedLabel ? `Assigned to ${job.assignedLabel}` : "Nobody assigned"}
          {" · "}
          {job.durationMinutes ? `${job.durationMinutes} minutes` : `usual length (${defaultMinutes} minutes)`}
        </p>
        {job.checklistTotal > 0 ? (
          <p className="text-xs text-ink-faint">
            Checklist: {job.checklistDone}/{job.checklistTotal}
          </p>
        ) : null}
      </div>
      <div className="relative z-10 flex items-center gap-2 self-end sm:self-center">
        {canSchedule && !job.scheduledAt ? (
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="rounded-control border border-line-strong bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-subtle"
          >
            Schedule
          </button>
        ) : null}
        <ActionMenu label={`Actions for ${jobTypeLabel(job.type)} for ${job.customerName}`} items={menuItems} />
      </div>

      {sheetOpen ? (
        <Sheet
          open={sheetOpen}
          onOpenChange={setSheetOpen}
          title={job.scheduledAt ? "Change time or person" : "Schedule this visit"}
          footer={
            <>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="rounded-control border border-line-strong px-4 py-2 text-sm font-semibold text-ink hover:bg-subtle"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => save([])}
                className="rounded-control bg-ink px-4 py-2 text-sm font-semibold text-canvas hover:opacity-90 disabled:opacity-50"
              >
                {job.scheduledAt ? "Save changes" : "Book the visit"}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div>
              <label htmlFor={`board-when-${job.id}`} className="block text-sm font-medium text-ink-soft">
                When
              </label>
              <input
                id={`board-when-${job.id}`}
                type="datetime-local"
                value={when}
                disabled={isPending}
                onChange={(e) => {
                  setWhen(e.target.value);
                  setConflicts([]);
                }}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor={`board-length-${job.id}`} className="block text-sm font-medium text-ink-soft">
                How long it takes, in minutes
              </label>
              <input
                id={`board-length-${job.id}`}
                type="text"
                inputMode="numeric"
                value={durationText}
                disabled={isPending}
                onChange={(e) => {
                  setDurationText(e.target.value);
                  setConflicts([]);
                }}
                className="mt-1 w-32 rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label htmlFor={`board-who-${job.id}`} className="block text-sm font-medium text-ink-soft">
                Who is doing it
              </label>
              <select
                id={`board-who-${job.id}`}
                value={assignee}
                disabled={isPending}
                onChange={(e) => {
                  setAssignee(e.target.value);
                  setConflicts([]);
                }}
                className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
              >
                <option value="">Nobody yet</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.label}
                  </option>
                ))}
              </select>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-red-800">
                {error}
              </p>
            ) : null}
            {conflicts.length > 0 ? (
              <ScheduleConflictNotice
                conflicts={conflicts}
                disabled={isPending}
                onConfirm={(ids) => save(ids)}
              />
            ) : null}
          </div>
        </Sheet>
      ) : null}
    </li>
  );
}
