"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAction,
  approveAndSubmitAction,
  doneElsewhereAction,
  markSubmittedAction,
  notApplicableAction,
  prepareGuidedAction,
  resolveAction,
  type ComplianceActionState,
} from "../actions";

type Props = {
  filingId: string;
  state: string;
  preparedHash: string | null;
  channel: string;
  canPrepareGuided: boolean;
  isOwner: boolean;
};

const btn =
  "rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50";
const primaryBtn =
  "rounded-lg border border-action bg-action px-3 py-2 text-sm font-medium text-on-action disabled:opacity-50";

export function FilingActions({ filingId, state, preparedHash, channel, canPrepareGuided, isOwner }: Props) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ComplianceActionState>({});
  const [confirmation, setConfirmation] = useState("");

  const run = (fn: () => Promise<ComplianceActionState>) =>
    start(async () => {
      const res = await fn();
      setResult(res);
      if (res.ok) router.refresh();
    });

  return (
    <div className="space-y-3">
      {result.error ? (
        <p role="alert" className="rounded-card bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {result.error}
        </p>
      ) : null}
      {result.ok ? (
        <p className="rounded-card bg-tint px-4 py-3 text-sm font-medium text-ink">Saved.</p>
      ) : null}

      {state === "UPCOMING" && canPrepareGuided ? (
        <button type="button" className={primaryBtn} disabled={pending} onClick={() => run(() => prepareGuidedAction(filingId))}>
          Prepare the values to file
        </button>
      ) : null}

      {state === "READY_FOR_REVIEW" && preparedHash ? (
        <div className="flex flex-wrap items-center gap-2">
          {isOwner ? (
            <>
              <button
                type="button"
                className={primaryBtn}
                disabled={pending}
                onClick={() =>
                  run(() =>
                    channel === "GUIDED_WEB"
                      ? approveAction(filingId, preparedHash)
                      : approveAndSubmitAction(filingId, preparedHash, confirmation),
                  )
                }
              >
                {channel === "GUIDED_WEB" ? "Approve these numbers" : "Approve and file"}
              </button>
              <span className="text-sm text-ink-soft">
                Approving locks in exactly the numbers above.
              </span>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Waiting for the owner to approve these numbers.</p>
          )}
        </div>
      ) : null}

      {state === "APPROVED" && isOwner ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-ink">Confirmation (optional)</span>
            <input
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="Confirmation number, or “mailed on …”"
              className="w-72 rounded-lg border border-border bg-card px-3 py-2"
            />
          </label>
          <button
            type="button"
            className={primaryBtn}
            disabled={pending}
            onClick={() => run(() => markSubmittedAction(filingId, confirmation))}
          >
            Mark submitted
          </button>
        </div>
      ) : null}

      {state === "SUBMITTED" ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => resolveAction(filingId, "ACCEPTED"))}>
            Mark accepted
          </button>
          <button type="button" className={btn} disabled={pending} onClick={() => run(() => resolveAction(filingId, "REJECTED"))}>
            Mark rejected
          </button>
        </div>
      ) : null}

      {["UPCOMING", "READY_FOR_REVIEW", "APPROVED"].includes(state) ? (
        <div className="flex flex-wrap gap-2">
          {isOwner ? (
            <button type="button" className={btn} disabled={pending} onClick={() => run(() => doneElsewhereAction(filingId))}>
              I handled this another way
            </button>
          ) : null}
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() => run(() => notApplicableAction(filingId, "Marked not needed from the filing page."))}
          >
            This doesn&apos;t apply
          </button>
        </div>
      ) : null}
    </div>
  );
}
