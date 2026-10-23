"use client";

import { confirmAction, customerConfirmLabels } from "@/lib/confirm-action";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { turnOffAutoRenewAction } from "./actions";

export function TurnOffAutoRenew({ agreementId }: { agreementId: string }) {
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
              tr("Turn off automatic renewal? Your rental will end on its end date instead of continuing month to month."),
              customerConfirmLabels(tr),
            ))
          )
            return;
          setError(null);
          startTransition(async () => {
            const result = await turnOffAutoRenewAction({ agreementId });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          });
        }}
      >
        {pending ? tr("Saving…") : tr("Turn off automatic renewal")}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </div>
  );
}
