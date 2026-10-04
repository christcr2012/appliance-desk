"use client";

import { useState } from "react";
import { updateJobSchedulingAction } from "./actions";
import {
  RECOMMENDED_JOB_DURATION_MINUTES,
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
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}
      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-gray-900">Usual visit length</legend>
        <p className="text-sm text-gray-600">
          When a visit has no length of its own, the schedule assumes it takes this many minutes. It is used to
          warn you when two visits for the same person overlap. A visit that ends exactly when the next one
          starts is not a conflict. Starting value: 120 (2 hours), a generous time for a delivery, install,
          pickup or repair including the drive to the next stop. Anyone with owner or admin access can change it.
        </p>
        <div>
          <label htmlFor="jobs-defaultMinutes" className="mb-1 block text-sm font-medium text-gray-900">
            Minutes per visit
          </label>
          <input
            id="jobs-defaultMinutes"
            type="text"
            inputMode="numeric"
            className="w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm"
            value={values.defaultJobDurationMinutes}
            onChange={(e) => setValues({ defaultJobDurationMinutes: e.target.value })}
          />
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-900"
          onClick={() => setValues({ defaultJobDurationMinutes: String(RECOMMENDED_JOB_DURATION_MINUTES) })}
        >
          Restore recommended value ({RECOMMENDED_JOB_DURATION_MINUTES} minutes)
        </button>
      </div>
    </form>
  );
}
