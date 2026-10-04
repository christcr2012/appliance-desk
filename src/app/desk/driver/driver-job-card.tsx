"use client";

import { formatBusinessTime } from "@/lib/business-date";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobStatusAction, addJobPhotoAction } from "../jobs/actions";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { JobStatus, JobType } from "@prisma/client";
import { StatusBadge } from "@/components/status-badge";
import { jobStatusTone } from "@/lib/status-labels";

type DriverJob = {
  id: string;
  type: JobType;
  status: JobStatus;
  scheduledAt: Date | null;
  notes: string | null;
  customerName: string | null;
  customerPhone: string | null;
  address: { line1: string; line2: string | null; city: string; state: string; zip: string } | null;
  appliances: { id: string; label: string }[];
};

const TYPE_LABELS: Record<JobType, string> = {
  DELIVERY: "Delivery",
  INSTALLATION: "Installation",
  SWAP: "Swap",
  MAINTENANCE_VISIT: "Maintenance visit",
  REMOVAL: "Removal",
};

function formatTime(date: Date | null): string {
  if (!date) return "No time set";
  return formatBusinessTime(date);
}

function mapsUrl(address: DriverJob["address"]): string {
  const query = `${address?.line1}, ${address?.city}, ${address?.state} ${address?.zip}`;
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

export function DriverJobCard({ job }: { job: DriverJob }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");

  function handleStatusChange(status: JobStatus) {
    setError(null);
    // Completing a job needs a result for every item and the date the work was done: that form lives on the
    // job page, so the driver screen never completes a job by itself.
    if (status === "COMPLETED") {
      router.push(`/desk/jobs/${job.id}`);
      return;
    }
    startTransition(async () => {
      const result = await updateJobStatusAction(job.id, status);
      if (result.status === "error") {
        setError(result.message);
      } else {
        router.refresh();
      }
    });
  }

  function handleAddPhoto() {
    if (!photoUrl) return;
    setError(null);
    startTransition(async () => {
      const result = await addJobPhotoAction(job.id, { url: photoUrl });
      if (result.status === "error") {
        setError(result.message);
      } else {
        setPhotoUrl("");
        setShowPhoto(false);
        router.refresh();
      }
    });
  }

  const isDone = job.status === "COMPLETED" || job.status === "CANCELLED";

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-gray-900">
            {formatTime(job.scheduledAt)} — {TYPE_LABELS[job.type]}
          </p>
          {job.customerName && (
            <p className="mt-0.5 text-sm text-gray-700">{job.customerName}</p>
          )}
        </div>
        <StatusBadge
          tone={jobStatusTone(job.status)}
          label={job.status.replace(/_/g, " ")}
          variant="pill"
          className="shrink-0"
        />
      </div>

      {job.appliances.length > 0 && (
        <ul className="mt-2 text-sm text-gray-700">
          {job.appliances.map((a) => (
            <li key={a.id}>{a.label}</li>
          ))}
        </ul>
      )}

      {job.notes && <p className="mt-2 text-sm text-gray-600">{job.notes}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        {job.address && (
          <a
            href={mapsUrl(job.address)}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Get directions
          </a>
        )}
        {job.customerPhone && (
          <a
            href={`tel:${job.customerPhone}`}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400"
          >
            Call customer
          </a>
        )}
      </div>

      {!isDone && (
        <div className="mt-3 flex flex-wrap gap-2">
          {job.status === "SCHEDULED" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange("IN_PROGRESS")}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Start
            </button>
          )}
          {job.status === "IN_PROGRESS" && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => handleStatusChange("COMPLETED")}
              className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Mark complete
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowPhoto((s) => !s)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:border-gray-400 disabled:opacity-50"
          >
            {showPhoto ? "Cancel photo" : "Add photo"}
          </button>
        </div>
      )}

      {showPhoto && (
        <div className="mt-3 flex items-center gap-3 border-t border-gray-100 pt-3">
          {photoUrl && (
            <span className="text-xs text-green-700">Photo uploaded securely.</span>
          )}
          <PhotoUploadField
            pathPrefix={`jobs/${job.id}`}
            label={photoUrl ? "Replace photo" : "Take or choose a photo"}
            onUploaded={(url) => {
              setError(null);
              setPhotoUrl(url);
            }}
            onError={(message) => setError(message)}
          />
          {photoUrl && (
            <button
              type="button"
              disabled={isPending}
              onClick={handleAddPhoto}
              className="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              Save
            </button>
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
