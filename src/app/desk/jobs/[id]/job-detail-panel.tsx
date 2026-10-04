"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import {
  updateJobStatusAction,
  completeJobAction,
  removeUndeliveredItemAction,
  substituteWaitingItemAction,
  addJobPhotoAction,
  setJobRepairCostsAction,
  updateApplianceStatusFromJobAction,
  updateJobChecklistAction,
} from "../actions";
import type { JobApplianceResult, JobApplianceRole, JobOutcome, JobStatus, JobType, ApplianceStatus } from "@prisma/client";
import { APPLIANCE_STATUS_LABELS } from "@/domains/inventory/lifecycle";
import { parseChecklist, type ChecklistItem } from "@/domains/jobs/checklist";
import { PhotoUploadField } from "@/components/photo-upload-field";

const SUGGESTED_STATUS_FOR_TYPE: Record<JobType, ApplianceStatus | null> = {
  DELIVERY: null,
  INSTALLATION: null,
  SWAP: null, // finishing a swap moves both units itself
  REMOVAL: null,
  MAINTENANCE_VISIT: null,
};

const AUTOMATIC_ON_COMPLETE: Partial<Record<JobType, string>> = {
  DELIVERY: "Each item you mark Delivered becomes Rented. An item you mark Not delivered stays reserved and gets a follow-up task.",
  INSTALLATION: "Each item you mark Delivered becomes Rented. An item you mark Not delivered stays reserved and gets a follow-up task.",
  REMOVAL:
    "Each item you mark Returned moves to Awaiting inspection — check it over before it can be rented again. An item you mark Not picked up stays with the customer and gets a follow-up task.",
  SWAP:
    "When the new unit is Delivered it becomes Rented and takes over the agreement; the old unit, if Returned, moves to Awaiting inspection. If neither moved, the new unit goes back on the shelf and you get a task to reschedule. If the old unit was left behind, you get a task to collect it.",
};

const RESULT_LABELS: Record<JobApplianceResult, string> = {
  DELIVERED: "Delivered",
  NOT_DELIVERED: "Not delivered",
  RETURNED: "Returned (picked up)",
  NOT_RETURNED: "Not picked up",
  REPAIRED: "Repaired",
  NOT_REPAIRED: "Not repaired",
  NO_ACCESS: "Couldn't get to it",
};

type CompletionScopeRow = {
  applianceId: string;
  label: string;
  role: JobApplianceRole;
  allowed: JobApplianceResult[];
  defaultResult: JobApplianceResult;
};

function newCompletionKey(): string {
  return `ui-${crypto.randomUUID()}`;
}

const STATUS_LABEL = APPLIANCE_STATUS_LABELS;

const ALL_STATUSES: { value: JobStatus; label: string }[] = [
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

// Completing a job is its own form (every appliance needs a result), so only these two are plain buttons.
const ALLOWED_NEXT: Record<JobStatus, JobStatus[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["CANCELLED"],
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
    result?: JobApplianceResult | null;
    role?: JobApplianceRole;
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
  /** The monthly subscription still has to be lowered in Stripe for this cancelled item. */
  stripeUpdatePending: boolean;
  /** A same-type unit set aside to take this item's place, if any. */
  substituteLabel: string | null;
  substituteUnits: Array<{ id: string; label: string }>;
  substituteVisits: Array<{ id: string; label: string }>;
};

function SubstituteForm({
  item,
  disabled,
  onSubmit,
}: {
  item: PendingDeliveryRow;
  disabled: boolean;
  onSubmit: (pendingDeliveryId: string, unitId: string, visitId: string) => void;
}) {
  const [unitId, setUnitId] = useState(item.substituteUnits[0]?.id ?? "");
  const [visitId, setVisitId] = useState(item.substituteVisits[0]?.id ?? "");
  return (
    <div className="basis-full rounded-md border border-gray-200 p-3">
      <p className="text-sm font-medium text-gray-900">Send a different unit of the same type instead</p>
      <p className="mt-1 text-xs text-gray-600">
        The missing unit goes back on the shelf when the replacement is delivered. The monthly price does not change, and the customer is still credited for the days without it.
      </p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-xs text-gray-700">
          Unit
          <select value={unitId} onChange={(e) => setUnitId(e.target.value)} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm">
            {item.substituteUnits.map((u) => (
              <option key={u.id} value={u.id}>{u.label}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-gray-700">
          Delivery visit
          <select value={visitId} onChange={(e) => setVisitId(e.target.value)} className="mt-1 block rounded-md border border-gray-300 px-2 py-1 text-sm">
            {item.substituteVisits.map((v) => (
              <option key={v.id} value={v.id}>{v.label}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={disabled || !unitId || !visitId}
          onClick={() => onSubmit(item.id, unitId, visitId)}
          className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:border-gray-400 disabled:opacity-50"
        >
          Set this unit aside
        </button>
      </div>
    </div>
  );
}

export function JobDetailPanel({
  job,
  canViewFinance = false,
  completionScope = [],
  version,
  outcome = null,
  pendingDeliveries = [],
  today = "",
  partsFromList = false,
}: {
  job: JobRow;
  canViewFinance?: boolean;
  /** The appliances this visit needs a result for (only while the job is in progress). */
  completionScope?: CompletionScopeRow[];
  /** The job's version, so a stale screen cannot complete a job someone else changed. */
  version: number;
  /** COMPLETE or PARTIAL once the job is completed. */
  outcome?: JobOutcome | null;
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
  const [results, setResults] = useState<Record<string, JobApplianceResult>>(() =>
    Object.fromEntries(completionScope.map((row) => [row.applianceId, row.defaultResult])),
  );
  const [completionKey] = useState(newCompletionKey);
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
      const result = await updateJobStatusAction(job.id, status);
      if (result.status === "error") {
        setStatusMessage(result.message);
      }
      router.refresh();
    });
  }

  function handleComplete(e: React.FormEvent) {
    e.preventDefault();
    setStatusMessage(null);
    startTransition(async () => {
      const result = await completeJobAction(job.id, {
        expectedVersion: version,
        completionKey,
        performedOn,
        completionNotes,
        results: completionScope.map((row) => ({ applianceId: row.applianceId, result: results[row.applianceId] ?? row.defaultResult })),
      });
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

  function handleSubstitute(pendingDeliveryId: string, unitId: string, visitId: string) {
    setRemoveMessage(null);
    startTransition(async () => {
      const result = await substituteWaitingItemAction(pendingDeliveryId, unitId, visitId, job.id);
      setRemoveMessage(
        result.status === "error" ? result.message : "Unit set aside. It is delivered on that visit in place of the missing one, and the customer is credited for the days it was missing.",
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
          <form onSubmit={handleComplete} className="mt-3">
            {completionScope.length > 0 && (
              <fieldset>
                <legend className="text-sm font-medium text-gray-700">What happened with each item?</legend>
                <p className="text-xs text-gray-600">
                  Every item on this visit needs a result before the job can be completed. The usual result is already chosen; change it for anything that did not go as planned. {job.type === "DELIVERY" || job.type === "INSTALLATION" ? " The customer is still billed for the whole agreement; an item that did not arrive earns a credit for the missing days once it is delivered." : ""}
                </p>
                <ul className="mt-2 space-y-2">
                  {completionScope.map((row) => (
                    <li key={row.applianceId} className="flex flex-wrap items-center justify-between gap-2">
                      <label htmlFor={`result-${row.applianceId}`} className="text-sm text-gray-700">
                        {row.label}
                        {row.role === "REPLACEMENT" ? " (new unit)" : job.type === "SWAP" ? " (old unit)" : ""}
                      </label>
                      <select
                        id={`result-${row.applianceId}`}
                        value={results[row.applianceId] ?? row.defaultResult}
                        onChange={(e) => setResults((prev) => ({ ...prev, [row.applianceId]: e.target.value as JobApplianceResult }))}
                        className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                      >
                        {row.allowed.map((value) => (
                          <option key={value} value={value}>
                            {RESULT_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </fieldset>
            )}
            <label
              htmlFor="completionNotes"
              className="mt-3 block text-sm font-medium text-gray-700"
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
            {AUTOMATIC_ON_COMPLETE[job.type] && <p className="mt-2 text-sm text-gray-600">{AUTOMATIC_ON_COMPLETE[job.type]}</p>}
            <button
              type="submit"
              disabled={isPending}
              className="mt-3 rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
            >
              {isPending ? "Completing…" : "Complete job"}
            </button>
          </form>
        )}

        {job.status === "COMPLETED" && (
          <div className="mt-3 text-sm text-gray-700">
            {outcome && <p>{outcome === "COMPLETE" ? "Everything went as planned." : "Partly done: something on this visit did not go as planned, and a follow-up task was created for each."}</p>}
            {job.appliances.some((a) => a.result) && (
              <ul className="mt-2 space-y-1">
                {job.appliances.map((a) => (
                  <li key={a.appliance.id}>
                    {a.appliance.applianceType.name} ({a.appliance.assetNumber}): {a.result ? RESULT_LABELS[a.result] : "no result recorded"}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {nextStatuses.length === 0 && job.status !== "IN_PROGRESS" ? (
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
                      : item.substituteLabel
                        ? `; unit ${item.substituteLabel} is set aside to take its place`
                        : "; still waiting"}
                  {item.removed && item.stripeUpdatePending && (
                    <strong className="ml-1 font-medium text-gray-900"> Cancelled — Stripe update pending. The customer&apos;s monthly subscription has not been lowered yet; the system keeps retrying and the Billing check screen shows it until it is done.</strong>
                  )}
                </span>
                {canViewFinance && !item.deliveredOn && !item.removed && !item.substituteLabel && item.substituteUnits.length > 0 && item.substituteVisits.length > 0 && (
                  <SubstituteForm item={item} disabled={isPending} onSubmit={handleSubstitute} />
                )}
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
