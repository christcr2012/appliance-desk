"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endMonthToMonthRentalAction } from "./actions";

export function EndRental(props: {
  agreementId: string;
  effectiveOn: string;
  lastBilledDay: string;
  noticeDays: number;
  termsVersion: number;
  effectiveLabel: string;
  lastBilledLabel: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            const result = await endMonthToMonthRentalAction({
              agreementId: props.agreementId,
              effectiveOn: props.effectiveOn,
              lastBilledDay: props.lastBilledDay,
              noticeDays: props.noticeDays,
              termsVersion: props.termsVersion,
            });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          });
        }}
        className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle disabled:opacity-60"
      >
        {pending ? "Saving…" : `End my rental on ${props.effectiveLabel}`}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
