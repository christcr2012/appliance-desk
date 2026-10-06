"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ApplianceStatus } from "@prisma/client";
import {
  startRepairAction,
  retireApplianceAction,
  getSwapCandidatesAction,
  startSwapAction,
  recordInspectionAction,
  type SwapCandidate,
} from "../actions";
import { canTransitionApplianceStatus } from "@/domains/inventory/lifecycle";

type Panel = "repair" | "retire" | "swap" | "inspection" | null;

/**
 * The guided, one-click versions of things that used to be a manual,
 * multi-step (or in the swap case, literally impossible without a
 * database edit) process. Sits alongside the raw status buttons in
 * ApplianceDetailPanel — those still work for an edge case this doesn't
 * cover, but these are the ones Chris should reach for day to day. See
 * src/domains/inventory/guided-actions.ts for what each one actually does.
 */
export function GuidedActionsPanel({
  applianceId,
  status,
  inspectionChecklist,
}: {
  applianceId: string;
  status: ApplianceStatus;
  inspectionChecklist: { versionId: string; items: string[] };
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState<Panel>(null);
  const [error, setError] = useState<string | null>(null);

  const canRepair = canTransitionApplianceStatus(status, "MAINTENANCE").ok;
  const canRetire = canTransitionApplianceStatus(status, "RETIRED").ok;
  const canSwap = status === "RENTED";
  const canInspect = status === "AWAITING_INSPECTION";

  if (!canRepair && !canRetire && !canSwap && !canInspect) {
    return null;
  }

  function toggle(panel: Panel) {
    setError(null);
    setOpen((current) => (current === panel ? null : panel));
  }

  function handleRepair(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await startRepairAction(applianceId, {
        notes: String(data.get("notes") ?? ""),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  function handleRetire(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await retireApplianceAction(applianceId, {
        reason: String(data.get("reason") ?? ""),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  function handleInspection(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    // The pass/fail choice is which of the two submit buttons was
    // clicked, so FormData needs the submitter passed explicitly —
    // without it, a clicked submit button's own name/value isn't
    // included in the constructed FormData.
    const data = new FormData(e.currentTarget);
    const answers = inspectionChecklist.items.map((_, i) => data.get(`check-${i}`) === "on");
    startTransition(async () => {
      const result = await recordInspectionAction(applianceId, {
        expectedChecklistVersionId: inspectionChecklist.versionId,
        answers,
        overrideReason: String(data.get("overrideReason") ?? ""),
        notes: String(data.get("notes") ?? ""),
        condition: String(data.get("condition") ?? ""),
      });
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      setOpen(null);
      router.refresh();
    });
  }

  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <h2 className="font-medium text-ink">Guided actions</h2>
      <p className="mt-1 text-sm text-ink-soft">
        These handle the multi-step parts for you — the status change, the job, and the
        record — together, in one click.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        {canRepair && (
          <button
            type="button"
            onClick={() => toggle("repair")}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong"
          >
            Start a repair
          </button>
        )}
        {canSwap && (
          <button
            type="button"
            onClick={() => toggle("swap")}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong"
          >
            Swap for a working unit
          </button>
        )}
        {canInspect && (
          <button
            type="button"
            onClick={() => toggle("inspection")}
            className="rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink-soft hover:border-line-strong"
          >
            Record inspection
          </button>
        )}
        {canRetire && (
          <button
            type="button"
            onClick={() => toggle("retire")}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm text-red-700 hover:border-red-400"
          >
            Retire this appliance
          </button>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {open === "repair" && (
        <form onSubmit={handleRepair} className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-sm text-ink-soft">
            Moves this unit to Maintenance and schedules a maintenance-visit job for right
            now — you can reschedule it from the jobs page afterward.
          </p>
          <textarea
            name="notes"
            rows={2}
            placeholder="What's wrong with it? (optional)"
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-action px-3 py-1.5 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
          >
            {isPending ? "Starting…" : "Start repair"}
          </button>
        </form>
      )}

      {open === "retire" && (
        <form onSubmit={handleRetire} className="mt-4 space-y-2 border-t border-line pt-4">
          <p className="text-sm text-ink-soft">
            Retiring is permanent — this unit won&apos;t be rentable again. Add a new unit
            instead if this was a mistake.
          </p>
          <textarea
            name="reason"
            required
            rows={2}
            placeholder="Why is it being retired?"
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={isPending}
            className="rounded-md bg-red-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-800 disabled:opacity-50"
          >
            {isPending ? "Retiring…" : "Retire appliance"}
          </button>
        </form>
      )}

      {open === "swap" && (
        <SwapForm
          applianceId={applianceId}
          onError={setError}
          onDone={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}

      {open === "inspection" && (
        <form
          onSubmit={handleInspection}
          className="mt-4 space-y-3 border-t border-line pt-4"
        >
          <p className="text-sm text-ink-soft">
            Check every item that is OK. If every item is checked it goes back to Available.
            If any item is left unchecked it goes to Maintenance, unless you pass it on
            purpose below. The result is worked out for you, and a saved inspection cannot be edited.
          </p>
          <fieldset className="space-y-1">
            <legend className="sr-only">Inspection checklist</legend>
            {inspectionChecklist.items.map((item, i) => (
              <label key={i} className="flex items-center gap-2 text-sm text-ink-soft">
                <input type="checkbox" name={`check-${i}`} className="rounded" />
                {item}
              </label>
            ))}
          </fieldset>
          <div>
            <label htmlFor="overrideReason" className="block text-sm font-medium text-ink-soft">
              Pass it anyway: why? (optional)
            </label>
            <input
              id="overrideReason"
              name="overrideReason"
              type="text"
              placeholder="Only if an item is unchecked and you are sure it is fine"
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
            />
          </div>
          <div>
            <label htmlFor="condition" className="block text-sm font-medium text-ink-soft">
              Condition after inspection
            </label>
            <input
              id="condition"
              name="condition"
              type="text"
              className="mt-1 w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
            />
          </div>
          <textarea
            name="notes"
            rows={2}
            placeholder="Notes (optional)"
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isPending}
              className="rounded-md bg-action px-3 py-1.5 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
            >
              {isPending ? "Saving…" : "Record inspection"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function SwapForm({
  applianceId,
  onError,
  onDone,
}: {
  applianceId: string;
  onError: (message: string | null) => void;
  onDone: () => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [candidates, setCandidates] = useState<SwapCandidate[] | null>(null);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getSwapCandidatesAction(applianceId).then((result) => {
      if (!cancelled) {
        setCandidates(result);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [applianceId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) {
      onError("Choose a replacement unit.");
      return;
    }
    startTransition(async () => {
      const result = await startSwapAction(applianceId, selected);
      if (result.status === "error") {
        onError(result.message);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 space-y-2 border-t border-line pt-4">
      <p className="text-sm text-ink-soft">
        Unassigns this unit from its rental, assigns the replacement in its place, and
        schedules a swap job — this one goes to Maintenance, the replacement to Reserved
        until the swap job is completed.
      </p>
      {loading && <p className="text-sm text-ink-faint">Loading available units…</p>}
      {!loading && candidates && candidates.length === 0 && (
        <p className="text-sm text-ink-faint">
          No other available units of this appliance type — add one to inventory first.
        </p>
      )}
      {!loading && candidates && candidates.length > 0 && (
        <>
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="w-full rounded-md border border-line-strong px-3 py-1.5 text-sm"
          >
            <option value="">Choose a replacement…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.assetNumber} — {c.applianceTypeName}
                {c.manufacturer ? ` (${c.manufacturer}${c.model ? ` ${c.model}` : ""})` : ""}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={isPending || !selected}
            className="rounded-md bg-action px-3 py-1.5 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
          >
            {isPending ? "Swapping…" : "Start swap"}
          </button>
        </>
      )}
    </form>
  );
}
