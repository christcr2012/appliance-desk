"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobStatusAction, addJobPhotoAction } from "../actions";
import type { JobStatus } from "@prisma/client";

const ALL_STATUSES: { value: JobStatus; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

// Mirrors ALLOWED_JOB_TRANSITIONS in src/domains/jobs/index.ts — only to
// grey out invalid buttons; the real enforcement is server-side.
const ALLOWED_NEXT: Record<JobStatus, JobStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

type JobRow = {
  id: string;
  status: JobStatus;
  completionNotes: string | null;
  appliances: { appliance: { assetNumber: string; applianceType: { name: string } } }[];
  photos: { id: string; url: string; altText: string | null }[];
};

export function JobDetailPanel({ job }: { job: JobRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState(job.completionNotes ?? "");
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoAlt, setPhotoAlt] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);

  const nextStatuses = ALLOWED_NEXT[job.status];

  function handleStatusChange(status: JobStatus) {
    setStatusMessage(null);
    startTransition(async () => {
      const result = await updateJobStatusAction(
        job.id,
        status,
        status === "COMPLETED" ? completionNotes : undefined,
      );
      if (result.status === "error") {
        setStatusMessage(result.message);
      }
      router.refresh();
    });
  }

  function handleAddPhoto(e: React.FormEvent) {
    e.preventDefault();
    setPhotoError(null);
    startTransition(async () => {
      const result = await addJobPhotoAction(job.id, { url: photoUrl, altText: photoAlt });
      if (result.status === "error") {
        setPhotoError(result.message);
      } else {
        setPhotoUrl("");
        setPhotoAlt("");
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Status: {job.status}</h2>

        {job.status === "IN_PROGRESS" && (
          <div className="mt-3">
            <label
              htmlFor="completionNotes"
              className="block text-sm font-medium text-gray-700"
            >
              Completion notes (used when you mark it completed)
            </label>
            <textarea
              id="completionNotes"
              rows={2}
              value={completionNotes}
              onChange={(e) => setCompletionNotes(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        )}

        {nextStatuses.length === 0 ? (
          <p className="mt-3 text-sm text-gray-600">This job is closed out.</p>
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
        {statusMessage && (
          <p role="alert" className="mt-2 text-sm text-red-700">
            {statusMessage}
          </p>
        )}
      </div>

      {job.appliances.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Appliances on this visit</h2>
          <ul className="mt-2 space-y-1 text-sm text-gray-700">
            {job.appliances.map((a, i) => (
              <li key={i}>
                {a.appliance.applianceType.name} ({a.appliance.assetNumber})
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-5">
        <h2 className="font-medium text-gray-900">Condition photos</h2>

        {job.photos.length === 0 ? (
          <p className="text-sm text-gray-600">No photos added yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {job.photos.map((p) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={p.id}
                src={p.url}
                alt={p.altText ?? "Condition photo"}
                className="h-32 w-full rounded-lg object-cover"
              />
            ))}
          </div>
        )}

        <form onSubmit={handleAddPhoto} className="space-y-3 border-t border-gray-100 pt-4">
          <div>
            <label htmlFor="photoUrl" className="block text-sm font-medium text-gray-700">
              Photo URL
            </label>
            <input
              id="photoUrl"
              type="url"
              required
              placeholder="https://…"
              value={photoUrl}
              onChange={(e) => setPhotoUrl(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="photoAlt" className="block text-sm font-medium text-gray-700">
              Description (optional)
            </label>
            <input
              id="photoAlt"
              type="text"
              placeholder="e.g. Scratch on left panel before delivery"
              value={photoAlt}
              onChange={(e) => setPhotoAlt(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {isPending ? "Adding…" : "Add photo"}
          </button>
          {photoError && (
            <p role="alert" className="text-sm text-red-700">
              {photoError}
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
