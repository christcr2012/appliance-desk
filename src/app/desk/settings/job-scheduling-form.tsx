"use client";

import { useState } from "react";
import { Button, Checkbox, Field } from "@/components/ui";
import { updateJobSchedulingAction } from "./actions";
import {
  RECOMMENDED_JOB_DURATION_MINUTES,
  RECOMMENDED_STAFF_MAY_WORK_UNASSIGNED_JOBS,
  type JobSchedulingFormValues,
} from "@/domains/settings/job-scheduling";

/** "Visits and scheduling" settings, explained on the screen itself (what it does, the starting value and why, restore button). */
export function JobSchedulingForm({ defaultValues }: { defaultValues: JobSchedulingFormValues }) {
  const [values, setValues] = useState<JobSchedulingFormValues>(defaultValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateJobSchedulingAction(values);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Settings saved. They apply to every visit checked from now on." }
          : result.status === "error"
            ? { kind: "error", text: result.message }
            : null,
      );
    } catch {
      setMessage({
        kind: "error",
        text: "Settings could not be saved. Your changes are still in the form; please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-6">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${
            message.kind === "error" ? "text-danger" : "text-success"
          }`}
        >
          {message.text}
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">Usual visit length</legend>
        <p className="text-sm text-ink-soft">
          When a visit has no length of its own, the schedule assumes it takes this many minutes. It is used to
          warn you when two visits for the same person overlap. A visit that ends exactly when the next one
          starts is not a conflict. Starting value: 120 (2 hours), a generous time for a delivery, install,
          pickup or repair including the drive to the next stop. Anyone with owner or admin access can change it.
        </p>
        <div className="max-w-xs">
          <Field
            id="jobs-defaultMinutes"
            label="Minutes per visit"
            type="text"
            inputMode="numeric"
            value={values.defaultJobDurationMinutes}
            onChange={(event) =>
              setValues({ ...values, defaultJobDurationMinutes: event.target.value })
            }
          />
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">
          Can staff work jobs nobody is assigned to?
        </legend>
        <p className="text-sm text-ink-soft">
          Staff can always work the jobs assigned to them, while those jobs are scheduled or in progress. This
          choice is about jobs with no one assigned. On: any staff member can open and finish an unassigned job,
          which is how it works today. Off: staff can only work jobs assigned to them, and an owner or admin has
          to assign the job first. Either way, staff can only touch the appliances that are on the job, and never
          a job that is already finished or cancelled. Starting value: on, because it keeps the way things work
          today. Anyone with owner or admin access can change it.
        </p>
        <Checkbox
          id="jobs-staffUnassigned"
          label="Staff may work jobs that have no one assigned"
          checked={values.staffMayWorkUnassignedJobs}
          onChange={(event) =>
            setValues({ ...values, staffMayWorkUnassignedJobs: event.target.checked })
          }
        />
      </fieldset>

      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() =>
            setValues({
              defaultJobDurationMinutes: String(RECOMMENDED_JOB_DURATION_MINUTES),
              staffMayWorkUnassignedJobs: RECOMMENDED_STAFF_MAY_WORK_UNASSIGNED_JOBS,
            })
          }
        >
          Restore recommended values ({RECOMMENDED_JOB_DURATION_MINUTES} minutes, staff may work unassigned jobs)
        </Button>
      </div>
    </form>
  );
}
