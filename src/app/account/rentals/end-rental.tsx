"use client";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
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
      >
        {pending ? tr("Saving…") : `${tr("End my rental on")} ${props.effectiveLabel}`}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </div>
  );
}
