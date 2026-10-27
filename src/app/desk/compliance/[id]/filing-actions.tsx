"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveAction,
  approveAndSubmitAction,
  doneElsewhereAction,
  markSubmittedAction,
  markReviewedAction,
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
  /** ACCT-1: who marked the prepared numbers reviewed (owner, admin or the accountant), if anyone has. */
  reviewedLabel: string | null;
  /**
   * CMP-3 (PR #654 review): filings whose file is downloaded after
   * approval and filed in an outside system (the IRIS portal upload, the
   * BSA E-Filing Form 8300) must be approved first and marked submitted
   * only after the owner actually files — never "approve and file" in
   * one step, which recorded a submission that hadn't happened.
   */
  separateSubmission?: boolean;
};

const btn =
  "rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent disabled:opacity-50";
const primaryBtn =
  "rounded-lg border border-action bg-action px-3 py-2 text-sm font-medium text-on-action disabled:opacity-50";

export function FilingActions({ filingId, state, preparedHash, channel, canPrepareGuided, isOwner, reviewedLabel, separateSubmission }: Props) {
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

      {state === "UPCOMING" || state === "REJECTED" ? (
        canPrepareGuided ? (
          <button type="button" className={primaryBtn} disabled={pending} onClick={() => run(() => prepareGuidedAction(filingId))}>
            {state === "REJECTED" ? "Prepare again with corrected values" : "Prepare the values to file"}
          </button>
        ) : null
      ) : null}

      {state === "READY_FOR_REVIEW" && preparedHash ? (
        <div className="flex flex-wrap items-center gap-2">
          {reviewedLabel ? (
            <span className="text-sm font-medium text-ink">{reviewedLabel}</span>
          ) : (
            <button type="button" className={btn} disabled={pending} onClick={() => run(() => markReviewedAction(filingId))}>
              Mark reviewed
            </button>
          )}
          {isOwner ? (
            <>
              <button
                type="button"
                className={primaryBtn}
                disabled={pending}
                onClick={() =>
                  run(() =>
                    channel === "GUIDED_WEB" || separateSubmission
                      ? approveAction(filingId, preparedHash)
                      : approveAndSubmitAction(filingId, preparedHash, confirmation),
                  )
                }
              >
                {channel === "GUIDED_WEB" || separateSubmission ? "Approve these numbers" : "Approve and file"}
              </button>
              <span className="text-sm text-ink-soft">
                {separateSubmission
                  ? "Approving locks in exactly the numbers above. Then download the filing file, file it with the agency, and mark it submitted here."
                  : "Approving locks in exactly the numbers above."}
              </span>
            </>
          ) : (
            <p className="text-sm text-ink-soft">Waiting for the owner to approve these numbers.</p>
          )}
        </div>
      ) : null}

      {state === "READY_FOR_REVIEW" && canPrepareGuided ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={btn}
            disabled={pending}
            onClick={() => run(() => prepareGuidedAction(filingId))}
          >
            Prepare again with the latest numbers
          </button>
          <span className="text-sm text-ink-soft">
            If the facts behind these numbers changed — for example you just added last year&apos;s tax figures —
            prepare again before approving.
          </span>
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

      {["UPCOMING", "READY_FOR_REVIEW", "APPROVED", "REJECTED"].includes(state) ? (
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
