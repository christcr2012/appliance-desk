"use client";

import { formatBusinessTime } from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import { toast } from "@/components/kit/toaster";
import { StatusPill } from "@/components/kit/status-pill";
import { visitPill } from "@/domains/jobs/words";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateJobStatusAction, addJobPhotoAction } from "../jobs/actions";
import { PhotoUploadField } from "@/components/photo-upload-field";
import type { JobStatus, JobType } from "@prisma/client";

export type RouteStopCard = {
  id: string;
  type: JobType;
  status: JobStatus;
  noShowAt: Date | null;
  scheduledAt: Date | null;
  notes: string | null;
  customerName: string | null;
  customerPhone: string | null;
  unitLabel: string | null;
  accessNotes: string | null;
  address: { line1: string; line2: string | null; city: string; state: string; zip: string } | null;
  appliances: { id: string; label: string }[];
  /** False in the Everyone view for a stop assigned to someone else (KIT 6.5). */
  canWork: boolean;
  assignedToName: string | null;
};

function mapsUrl(address: NonNullable<RouteStopCard["address"]>): string {
  const query = `${address.line1}, ${address.city}, ${address.state} ${address.zip}`;
  return `https://maps.google.com/?q=${encodeURIComponent(query)}`;
}

const buttonClass =
  "inline-flex min-h-11 items-center justify-center rounded-field border border-line bg-white px-4 py-2 text-sm font-bold text-ink";
const primaryClass =
  "inline-flex min-h-11 items-center justify-center rounded-field bg-primary px-4 py-2 text-sm font-bold text-on-primary disabled:cursor-not-allowed disabled:opacity-50";
const deadLinkClass = "pointer-events-none opacity-50";

export function DriverJobCard({ job, stopNumber }: { job: RouteStopCard; stopNumber: number }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPhoto, setShowPhoto] = useState(false);
  const [photoUrl, setPhotoUrl] = useState("");
  const pill = visitPill(job);
  const disabled = !job.canWork || isPending;

  function handleStart() {
    setError(null);
    startTransition(async () => {
      const result = await updateJobStatusAction(job.id, "IN_PROGRESS");
      if (result.status === "error") {
        setError(result.message);
      } else {
        toast({
          message: `Started — ${job.customerName ?? "The customer"} has been marked as under way`,
        });
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

  return (
    <article className="rounded-card border border-line bg-white p-4" aria-label={`Stop ${stopNumber}`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-bold text-ink">
          <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-subtle text-xs font-extrabold">
            {stopNumber}
          </span>
          {job.scheduledAt ? formatBusinessTime(job.scheduledAt) : "No time set"} · {jobTypeLabel(job.type)}
        </p>
        <StatusPill label={pill.label} tone={pill.tone} />
      </div>

      <p className="mt-2 font-semibold text-ink">{job.customerName ?? "No customer"}</p>
      {job.unitLabel && <p className="text-sm text-ink-soft">{job.unitLabel}</p>}
      {job.address && (
        <p className="text-sm text-ink-soft">
          {job.address.line1}
          {job.address.line2 ? `, ${job.address.line2}` : ""}, {job.address.city}, {job.address.state}{" "}
          {job.address.zip}
        </p>
      )}
      {job.appliances.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-sm text-ink">
          {job.appliances.map((a) => (
            <li key={a.id}>{a.label}</li>
          ))}
        </ul>
      )}
      {job.notes && <p className="mt-2 text-sm text-ink">{job.notes}</p>}
      {job.accessNotes && (
        <p className="mt-2 rounded-field bg-subtle p-2 text-sm text-ink">{job.accessNotes}</p>
      )}

      {!job.canWork && job.assignedToName && (
        <p className="mt-3 text-sm font-semibold text-ink-soft">Assigned to {job.assignedToName}</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {job.address ? (
          <a
            className={`${buttonClass} ${job.canWork ? "" : deadLinkClass}`}
            href={mapsUrl(job.address)}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!job.canWork}
            tabIndex={job.canWork ? undefined : -1}
          >
            Directions
          </a>
        ) : null}
        {job.customerPhone ? (
          <a
            className={`${buttonClass} ${job.canWork ? "" : deadLinkClass}`}
            href={`tel:${job.customerPhone}`}
            aria-disabled={!job.canWork}
            tabIndex={job.canWork ? undefined : -1}
          >
            Call
          </a>
        ) : null}
        {job.status === "SCHEDULED" && (
          <button type="button" className={primaryClass} disabled={disabled} onClick={handleStart}>
            Start
          </button>
        )}
        {job.status === "IN_PROGRESS" && (
          <Link
            className={`${primaryClass} ${job.canWork ? "" : deadLinkClass}`}
            href={`/desk/jobs/${job.id}#finish`}
            aria-disabled={!job.canWork}
            tabIndex={job.canWork ? undefined : -1}
          >
            Finish visit…
          </Link>
        )}
        <button
          type="button"
          className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-50`}
          disabled={disabled}
          onClick={() => setShowPhoto((v) => !v)}
        >
          Add photo
        </button>
      </div>

      {showPhoto && job.canWork && (
        <div className="mt-3 space-y-2">
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
            <button type="button" className={primaryClass} disabled={disabled} onClick={handleAddPhoto}>
              Save photo
            </button>
          )}
        </div>
      )}
    </article>
  );
}
