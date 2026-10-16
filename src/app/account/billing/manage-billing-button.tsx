"use client";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { openBillingPortalAction } from "./actions";

export function ManageBillingButton() {
  const language = useCustomerLanguage();
  const tr = useCustomerTranslation();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleClick() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortalAction();
      if (result && "error" in result) {
        setError(result.error);
      }
    });
  }

  return (
    <div>
      <Button
        type="button"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? tr("Opening…") : tr("Manage payment method & billing")}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </div>
  );
}
