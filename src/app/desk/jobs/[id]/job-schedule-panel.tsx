"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markJobNoShowAction, scheduleJobAction, type ScheduleConflictView } from "../actions";
import { ScheduleConflictNotice } from "../schedule-conflicts";

/**
 * When, how long and who. Owners and admins can change all three; the person a visit is assigned
 * to (staff) can only mark a no-show. A stale screen is refused (version) rather than overwriting.
 */
export function JobSchedulePanel({
  jobId,
  version,
  status,
  scheduledAtLocal,
  scheduledLabel,
  durationMinutes,
  assignedToUserId,
  assignedLabel,
  teamMembers,
  canSchedule,
  canMarkNoShow,
  noShowAt,
}: {
  jobId: string;
  version: number;
  status: string;
  /** Colorado clock time as YYYY-MM-DDTHH:mm, or "" when unscheduled. */
  scheduledAtLocal: string;
  scheduledLabel: string | null;
  durationMinutes: number | null;
  assignedToUserId: string | null;
  assignedLabel: string | null;
  teamMembers: { id: string; label: string }[];
  canSchedule: boolean;
  canMarkNoShow: boolean;
  noShowAt: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [when, setWhen] = useState(scheduledAtLocal);
  const [durationText, setDurationText] = useState(durationMinutes ? String(durationMinutes) : "");
  const [assignee, setAssignee] = useState(assignedToUserId ?? "");
  const [conflicts, setConflicts] = useState<ScheduleConflictView[]>([]);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const open = status === "SCHEDULED" || status === "IN_PROGRESS";

  function save(confirmed: string[]) {
    setMessage(null);
    const minutes = durationText.trim() === "" ? null : Number(durationText.trim());
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 15 || minutes > 720)) {
      setMessage({ kind: "error", text: "Visit length: enter a whole number of minutes between 15 and 720, or leave it blank." });
      return;
    }
    if (!when) {
      setMessage({ kind: "error", text: "Choose a date and time." });
      return;
    }
    startTransition(async () => {
      const result = await scheduleJobAction({
        jobId,
        expectedVersion: version,
        scheduledAt: when,
        durationMinutes: minutes,
        assignedToUserId: assignee || null,
        confirmedConflictJobIds: confirmed,
      });
      if (result.status === "conflict") {
        setConflicts(result.conflicts);
      } else if (result.status === "error") {
        setConflicts([]);
        setMessage({ kind: "error", text: result.message });
      } else {
        setConflicts([]);
        setMessage({ kind: "ok", text: "Saved." });
        router.refresh();
      }
    });
  }

  function noShow() {
    setMessage(null);
    startTransition(async () => {
      const result = await markJobNoShowAction(jobId, version);
      if (result.status === "error") setMessage({ kind: "error", text: result.message });
      else router.refresh();
    });
  }

  return (
    <section className="space-y-3 rounded-lg border border-gray-200 bg-white p-4" aria-labelledby="schedule-heading">
      <h2 id="schedule-heading" className="font-medium text-gray-900">
        Schedule
      </h2>
      <p className="text-sm text-gray-700">
        {scheduledLabel ?? "Not scheduled yet"}
        {durationMinutes ? ` · ${durationMinutes} minutes` : " · usual visit length"}
        {assignedLabel ? ` · ${assignedLabel}` : " · nobody assigned"}
      </p>
      {noShowAt && <p className="text-sm text-amber-800">Marked as a no-show — nobody was there. Nothing else was changed.</p>}
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={`text-sm ${message.kind === "error" ? "text-red-800" : "text-green-800"}`}>
          {message.text}
        </p>
      )}
      {canSchedule && open && (
        <div className="space-y-3">
          <div>
            <label htmlFor="sched-when" className="block text-sm font-medium text-gray-700">
              When
            </label>
            <input
              id="sched-when"
              type="datetime-local"
              value={when}
              onChange={(e) => {
                setWhen(e.target.value);
                setConflicts([]);
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="sched-duration" className="block text-sm font-medium text-gray-700">
              How long it takes, in minutes
            </label>
            <input
              id="sched-duration"
              type="text"
              inputMode="numeric"
              value={durationText}
              onChange={(e) => {
                setDurationText(e.target.value);
                setConflicts([]);
              }}
              className="mt-1 w-32 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="sched-assignee" className="block text-sm font-medium text-gray-700">
              Who is doing it
            </label>
            <select
              id="sched-assignee"
              value={assignee}
              onChange={(e) => {
                setAssignee(e.target.value);
                setConflicts([]);
              }}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Nobody assigned</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          {conflicts.length > 0 && <ScheduleConflictNotice conflicts={conflicts} disabled={isPending} onConfirm={(ids) => save(ids)} />}
          <button
            type="button"
            disabled={isPending}
            onClick={() => save([])}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isPending ? "Saving…" : "Save schedule"}
          </button>
        </div>
      )}
      {canMarkNoShow && open && (
        <div className="border-t border-gray-100 pt-3">
          <p className="text-sm text-gray-600">
            If nobody was there, mark a no-show. The visit is cancelled and frees this person&apos;s time. No appliance, charge or
            credit is changed.
          </p>
          <button
            type="button"
            disabled={isPending}
            onClick={noShow}
            className="mt-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-900 disabled:opacity-60"
          >
            Nobody was there (no-show)
          </button>
        </div>
      )}
    </section>
  );
}
