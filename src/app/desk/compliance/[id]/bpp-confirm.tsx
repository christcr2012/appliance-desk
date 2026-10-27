"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { notApplicableAction, type ComplianceActionState } from "../actions";

/**
 * CMP-4 (PR #668 review): the under-exemption close. Preparing the
 * declaration never closes it on its own — the snapshot totals only
 * the property the app tracks — so the owner confirms here that the
 * tracked fleet really is everything before the filing closes as
 * "No declaration needed" with its numbers kept.
 */
export function BppConfirmNoDeclaration({ filingId, note }: { filingId: string; note: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ComplianceActionState>({});

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-lg border border-action bg-action px-3 py-2 text-sm font-medium text-on-action disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await notApplicableAction(filingId, note);
            setResult(res);
            if (res.ok) router.refresh();
          })
        }
      >
        This is everything we own — no declaration needed
      </button>
      {result.error ? (
        <p role="alert" className="rounded-card bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {result.error}
        </p>
      ) : null}
    </div>
  );
}
