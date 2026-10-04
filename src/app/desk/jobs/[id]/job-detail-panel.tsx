"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  updateJobStatusAction,
  removeUndeliveredItemAction,
  addJobPhotoAction,
  setJobRepairCostsAction,
  updateApplianceStatusFromJobAction,
  updateJobChecklistAction,
} from "../actions";
import type { JobStatus, JobType, ApplianceStatus } from "@prisma/client";
import { APPLIANCE_STATUS_LABELS } from "@/domains/inventory/lifecycle";
import { parseChecklist, type ChecklistItem } from "@/domains/jobs/checklist";
import { PhotoUploadField } from "@/components/photo-upload-field";

const SUGGESTED_STATUS_FOR_TYPE: Record<JobType, ApplianceStatus | null> = {
  DELIVERY: null,
  INSTALLATION: null,
  SWAP: "RENTED",
  REMOVAL: null,
  MAINTENANCE_VISIT: null,
};

const AUTOMATIC_ON_COMPLETE: Partial<Record<JobType, string>> = {
  DELIVERY: "Marking this completed marks its reserved appliances as Rented.",
  INSTALLATION: "Marking this completed marks its reserved appliances as Rented.",
  REMOVAL:
    "Marking this completed moves its appliances to Awaiting inspection — check them over before they can be rented again.",
};

const STATUS_LABEL = APPLIANCE_STATUS_LABELS;

const ALL_STATUSES: { value: JobStatus; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

const ALLOWED_NEXT: Record<JobStatus, JobStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

type JobRow = {
  id: string;
  type: JobType;
  status: JobStatus;
  completionNotes: string | null;
  partsCostCents?: number | null;
  laborCostCents?: number | null;
  checklist: unknown;
  appliances: {
    appliance: {
      id: string;
      assetNumber: string;
      status: ApplianceStatus;
      applianceType: { name: string };
    };
  }[];
  photos: { id: string; url: string; altText: string | null }[];
  swapReplacementIds?: string[];
};

function revokePreview(url: string): void {
  if (url.startsWith("blob:")) URL.revokeObjectURL(url);
}

type PendingDeliveryRow = {
  id: string;
  label: string;
  originalDeliveryDate: string;
  deliveredOn: string | null;
  removed: boolean;
  /** A customer credit exists for this item (none when billing never started or the rental was prepaid). */
  hasCredit: boolean;
};

export function JobDetailPanel({
  job,
  canViewFinance = false,
  deliveryCandidates = [],
  pendingDeliveries = [],
  today = "",
  partsFromList = false,
}: {
  job: JobRow;
  canViewFinance?: boolean;
  /** DELIVERY/INSTALLATION only: the appliances this visit will mark delivered, to tick off any that were not. */
  deliveryCandidates?: Array<{ id: string; label: string }>;
  /** Items this delivery visit recorded as not delivered. */
  pendingDeliveries?: PendingDeliveryRow[];
  /** Today's Colorado date (YYYY-MM-DD), the default "date the work was done". */
  today?: string;
  /** Parts were itemized from the parts list, so the parts cost comes from there and is not typed by hand. */
  partsFromList?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [completionNotes, setCompletionNotes] = useState(job.completionNotes ?? "");
  const [performedOn, setPerformedOn] = useState(today);
  const [notDelivered, setNotDelivered] = useState<Set<string>>(new Set());
  const [removeMessage, setRemoveMessage] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState("");
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [photoAlt, setPhotoAlt] = useState("");
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [partsCostDollars, setPartsCostDollars] = useState(
    job.partsCostCents != null ? (job.partsCostCents / 100).toFixed(2) : "",
  );
  const [laborCostDollars, setLaborCostDollars] = useState(
    job.laborCostCents != null ? (job.laborCostCents / 100).toFixed(2) : "",
  );
  const [costError, setCostError] = useState<string | null>(null);
  const [costSaved, setCostSaved] = useState(false);
  const [appliancesJustUpdated, setAppliancesJustUpdated] = useState<Set<string>>(
    new Set(),
  );
  const [checklist, setChecklist] = useState<ChecklistItem[]>(() =>
    parseChecklist(job.checklist, job.type),
  );

  const nextStatuses = ALLOWED_NEXT[job.status];
  const suggestedStatus = SUGGESTED_STATUS_FOR_TYPE[job.type];
  const appliancesNeedingUpdate =
    job.status === "COMPLETED" && suggestedStatus
      ? job.appliances
          .map((a) => a.appliance)
          .filter(
            (a) =>
              a.status !== suggestedStatus &&
              !appliancesJustUpdated.has(a.id) &&
              (job.type !== "SWAP" || job.swapReplacementIds?.includes(a.id) === true),
          )
      : [];

  function handleUpdateApplianceStatus(applianceId: string, status: ApplianceStatus) {
    setStatusMessage(null);
    startTransition(async () => {
      const result = await updateApplianceStatusFromJobAction(applianceId, status, job.id);
      if (result.status === "error") {
        setStatusMessage(result.message);
      } else {
        setAppliancesJustUpdated((prev) => new Set(prev).add(applianceId));
        router.refresh();
      }
    });
  }

  function handleSaveCosts(e: React.FormEvent) {
    e.preventDefault();
    setCostError(null);
    setCostSaved(false);
    startTransition(async () => {
      const result = await setJobRepairCostsAction(job.id, {
        partsCostDollars: partsFromList ? "" : partsCostDollars,
        laborCostDollars,
      });
      if (result.status === "error") {
        setCostError(result.message);
      } else {
        setCostSaved(true);
        router.refresh();
      }
    });
  }

  function handleStatusChange(status: JobStatus) {
    setStatusMessage(null);
    startTransition(async () => {
      const result = await updateJobStatusAction(
        job.id,
        status,
        status === "COMPLETED" ? completionNotes : undefined,
        status === "COMPLETED" ? { performedOn, notDeliveredApplianceIds: [...notDelivered] } : undefined,
      );
      if (result.status === "error") {
        setStatusMessage(result.message);
      }
      router.refresh();
    });
  }

  function handleRemoveUndelivered(pendingDeliveryId: string) {
    setRemoveMessage(null);
    startTransition(async () => {
      const result = await removeUndeliveredItemAction(pendingDeliveryId, job.id);
      setRemoveMessage(
        result.status === "error" ? result.message : "Taken off the agreement. The credit shows on the customer's next bill.",
      );
      router.refresh();
    });
  }

  function handleToggleChecklist(index: number) {
    const next = checklist.map((item, i) =>
      i === index ? { ...item, checked: !item.checked } : item,
    );
    setChecklist(next);
    startTransition(async () => {
      await updateJobChecklistAction(job.id, next);
    });
  }

  function handleAddPhoto(e: React.FormEvent) {
    e.preventDefault();
    setPhotoError(null);
    startTransition(async () => {
      const result = await addJobPhotoAction(job.id, {
        url: photoUrl,
        altText: photoAlt,
      });
      if (result.status === "error") {
        setPhotoError(result.message);
      } else {
        revokePreview(photoPreviewUrl);
        setPhotoUrl("");
        setPhotoPreviewUrl("");
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
            <label htmlFor="performedOn" className="mt-3 block text-sm font-medium text-gray-700">
              Date the work was done
            </label>
            <input
              id="performedOn"
              type="date"
              value={performedOn}
              onChange={(e) => setPerformedOn(e.target.value)}
              aria-describedby="performedOn-help"
              className="mt-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p id="performedOn-help" className="mt-1 text-xs text-gray-600">
              Billing counts days from this date (a late return, or an item delivered late), not from the moment you press the button. Change it if you are recording the visit a day or two later.
            </p>
            {deliveryCandidates.length > 0 && (
              <fieldset className="mt-3">
                <legend className="text-sm font-medium text-gray-700">Anything NOT delivered on this visit?</legend>
                <p className="text-xs text-gray-600">
                  Tick an item that did not make it. The customer is still billed for the whole agreement from today; when the item arrives on a later delivery job they get a credit for the days it was missing, shown on their next bill.
                </p>
                <ul className="mt-2 space-y-1">
                  {deliveryCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <label className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          className="rounded"
                          checked={notDelivered.has(candidate.id)}
                          onChange={(e) =>
                            setNotDelivered((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(candidate.id);
                              else next.delete(candidate.id);
                              return next;
                            })
                          }
                        />
                        {candidate.label} — not delivered
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
          </div>
        )}

        {nextStatuses.includes("COMPLETED") && AUTOMATIC_ON_COMPLETE[job.type] && (
          <p className="mt-3 text-sm text-gray-600">{AUTOMATIC_ON_COMPLETE[job.type]}</p>
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

      {pendingDeliveries.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Items not delivered on this visit</h2>
          <p className="mt-1 text-sm text-gray-600">
            The customer is billed for these from the original delivery date. Schedule a delivery job for each one; when that job is completed the credit for the missing days is worked out automatically.
          </p>
          <ul className="mt-3 space-y-2 text-sm text-gray-700">
            {pendingDeliveries.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  {item.label} — billed from {item.originalDeliveryDate}
                  {item.deliveredOn
                    ? item.hasCredit
                      ? `; delivered ${item.deliveredOn}, credit recorded`
                      : `; delivered ${item.deliveredOn}, no automatic credit (nothing was billed to credit, or the rental was paid in advance and the owner settles it by hand)`
                    : item.removed
                      ? item.hasCredit
                        ? "; taken off the agreement, credit recorded"
                        : "; taken off the agreement, no automatic credit (the owner settles it by hand)"
                      : "; still waiting"}
                </span>
                {!item.deliveredOn && !item.removed && (
                  <span className="flex flex-wrap gap-2">
                    <Link href="/desk/jobs/new" className="text-primary hover:underline">
                      Schedule a delivery
                    </Link>
                    {canViewFinance && (
                      <button
                        type="button"
                        disabled={isPending}
                        onClick={() => handleRemoveUndelivered(item.id)}
                        className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-gray-400 disabled:opacity-50"
                      >
                        Never delivered — take it off the agreement and credit it
                      </button>
                    )}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {removeMessage && (
            <p role="status" className="mt-2 text-sm text-gray-700">
              {removeMessage}
            </p>
          )}
        </div>
      )}

      {checklist.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">
            Checklist ({checklist.filter((i) => i.checked).length}/{checklist.length})
          </h2>
          <p className="mt-1 text-sm text-gray-600">
            A memory aid for the visit — nothing here is required to mark this job
            completed.
          </p>
          <ul className="mt-3 space-y-2">
            {checklist.map((item, i) => (
              <li key={item.item}>
                <label className="flex items-start gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={item.checked}
                    onChange={() => handleToggleChecklist(i)}
                    className="mt-0.5 rounded"
                  />
                  <span className={item.checked ? "text-gray-600 line-through" : ""}>
                    {item.item}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {job.status === "COMPLETED" &&
        job.type === "SWAP" &&
        !job.swapReplacementIds?.length && (
          <p className="rounded-lg border border-gray-200 bg-white p-5 text-sm text-gray-700">
            This visit has no recorded replacement appliance. Ask an owner or admin to
            confirm the incoming unit before updating its status.
          </p>
        )}

      {appliancesNeedingUpdate.length > 0 && suggestedStatus && (
        <div className="rounded-lg border border-gray-200 bg-primary-soft p-5">
          <h2 className="font-medium text-primary-dark">Update appliance status?</h2>
          <p className="mt-1 text-sm text-primary-dark">
            This job&apos;s done — want to mark{" "}
            {appliancesNeedingUpdate.length === 1 ? "it" : "these"} as{" "}
            {STATUS_LABEL[suggestedStatus]} now? This never happens automatically — you
            decide each time.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {appliancesNeedingUpdate.map((appliance) => (
              <button
                key={appliance.id}
                type="button"
                disabled={isPending}
                onClick={() => handleUpdateApplianceStatus(appliance.id, suggestedStatus)}
                className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
              >
                Mark {appliance.assetNumber} as {STATUS_LABEL[suggestedStatus]}
              </button>
            ))}
            <Link
              href={`/desk/inventory/${appliancesNeedingUpdate[0].id}`}
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:border-gray-400"
            >
              Go to the appliance instead
            </Link>
          </div>
        </div>
      )}

      {canViewFinance && job.type === "MAINTENANCE_VISIT" && (
        <div className="rounded-lg border border-gray-200 bg-white p-5">
          <h2 className="font-medium text-gray-900">Repair cost</h2>
          <p className="mt-1 text-sm text-gray-600">
            What this repair actually cost — used to track each appliance&apos;s
            profitability on the Fleet page. Leave blank if unknown; it&apos;s counted as
            $0 until you enter it.
          </p>
          <form onSubmit={handleSaveCosts} className="mt-3 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="partsCost" className="block text-sm font-medium text-gray-700">
                Parts cost
              </label>
              <input
                id="partsCost"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={partsFromList ? "" : partsCostDollars}
                disabled={partsFromList}
                onChange={(e) => setPartsCostDollars(e.target.value)}
                className="mt-1 w-28 rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
              />
              {partsFromList && <p className="mt-1 max-w-48 text-xs text-gray-600">From the parts list above.</p>}
            </div>
            <div>
              <label htmlFor="laborCost" className="block text-sm font-medium text-gray-700">
                Labor cost
              </label>
              <input
                id="laborCost"
                type="number"
                step="0.01"
                min="0"
                inputMode="decimal"
                placeholder="0.00"
                value={laborCostDollars}
                onChange={(e) => setLaborCostDollars(e.target.value)}
                className="mt-1 w-28 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:border-gray-400 disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Save cost"}
            </button>
          </form>
          {costError && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {costError}
            </p>
          )}
          {costSaved && !costError && (
            <p className="mt-2 text-sm text-green-700">Saved.</p>
          )}
        </div>
      )}

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
              <div key={p.id} className="relative h-32 w-full overflow-hidden rounded-lg">
                <Image
                  src={p.url}
                  alt={p.altText ?? "Condition photo"}
                  fill
                  sizes="(min-width: 640px) 33vw, 45vw"
                  className="object-cover"
                />
              </div>
            ))}
          </div>
        )}

        <form onSubmit={handleAddPhoto} className="space-y-3 border-t border-gray-100 pt-4">
          <div>
            <span className="block text-sm font-medium text-gray-700">Photo</span>
            <div className="mt-1 flex items-center gap-3">
              {photoPreviewUrl && (
                <Image
                  src={photoPreviewUrl}
                  alt="Selected condition photo, not yet added"
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 rounded-md object-cover"
                />
              )}
              <PhotoUploadField
                pathPrefix={`jobs/${job.id}`}
                label={photoUrl ? "Replace photo" : "Take or choose a photo"}
                onUploaded={(storageUrl, previewUrl) => {
                  setPhotoError(null);
                  revokePreview(photoPreviewUrl);
                  setPhotoUrl(storageUrl);
                  setPhotoPreviewUrl(previewUrl);
                }}
                onError={(message) => setPhotoError(message)}
              />
            </div>
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
            disabled={isPending || !photoUrl}
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
