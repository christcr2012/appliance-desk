"use client";

import { confirmAction } from "@/lib/confirm-action";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
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
  const tr = useCustomerTranslation();
  const language = useCustomerLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          if (
            !(await confirmAction(
              `${tr("Request the ending shown above for")} ${props.effectiveLabel}? ${tr("This does not charge your card automatically.")}`,
            ))
          )
            return;
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
      >
        {pending ? tr("Saving…") : `${tr("Request ending on")} ${props.effectiveLabel}`}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </div>
  );
}
