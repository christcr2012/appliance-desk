"use client";

import { confirmAction, customerConfirmLabels } from "@/lib/confirm-action";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { setCustomerAutoRenewAction } from "./actions";

export function AutoRenewControl(props: {
  agreementId: string;
  enabled: boolean;
  termsVersion: string;
}) {
  const tr = useCustomerTranslation();
  const language = useCustomerLanguage();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const nextEnabled = !props.enabled;

  return (
    <div className="mt-3">
      <Button
        type="button"
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          const prompt = nextEnabled
            ? tr("Turn on automatic renewal using the terms shown above?")
            : tr("Turn off automatic renewal? Your rental will end on its existing end date unless you arrange something else.");
          if (!(await confirmAction(prompt, customerConfirmLabels(tr)))) return;
          setError(null);
          startTransition(async () => {
            const result = await setCustomerAutoRenewAction({
              agreementId: props.agreementId,
              enabled: nextEnabled,
              termsVersion: props.termsVersion,
            });
            if (result.status === "error") setError(result.message);
            else router.refresh();
          });
        }}
      >
        {pending
          ? tr("Saving…")
          : props.enabled
            ? tr("Turn off automatic renewal")
            : tr("Turn on automatic renewal")}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </div>
  );
}
