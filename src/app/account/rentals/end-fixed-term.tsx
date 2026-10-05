"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { endFixedTermRentalAction } from "./actions";

export function EndFixedTerm(props: {
  agreementId: string;
  effectiveOn: string;
  effectiveLabel: string;
  remainingTermMonths: number;
  remainingRentCents: number;
  feeCents: number;
  unusedTermCents: number;
  unusedTermTreatment: "REFUND" | "CREDIT" | "RETAIN";
  prepaidReviewRequired: boolean;
  unpaidBalanceCents: number;
  policyVersion: string;
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
          if (!window.confirm(`Request the ending shown above for ${props.effectiveLabel}? This does not charge your card automatically.`)) return;
          setError(null);
          startTransition(async () => {
            const result = await endFixedTermRentalAction({
              agreementId: props.agreementId,
              effectiveOn: props.effectiveOn,
              remainingTermMonths: props.remainingTermMonths,
              remainingRentCents: props.remainingRentCents,
              feeCents: props.feeCents,
              unusedTermCents: props.unusedTermCents,
              unusedTermTreatment: props.unusedTermTreatment,
              prepaidReviewRequired: props.prepaidReviewRequired,
              unpaidBalanceCents: props.unpaidBalanceCents,
              policyVersion: props.policyVersion,
            });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          });
        }}
        className="min-h-11 rounded-lg border border-control px-4 py-2 text-sm text-primary hover:bg-subtle disabled:opacity-60"
      >
        {pending ? "Saving…" : `Request ending on ${props.effectiveLabel}`}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
