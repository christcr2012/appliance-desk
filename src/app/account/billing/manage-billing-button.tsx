"use client";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { openBillingPortalAction } from "./actions";

/** PORTAL-1 section 5.4: "Card or bank details" — Stripe's own hosted
 * billing portal still does the work (see ./actions); only the button
 * styling moved to kit tokens. */
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
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        className="inline-flex min-h-11 items-center rounded-control border border-line-strong bg-surface px-4 py-2 text-sm font-semibold text-ink hover:bg-tint disabled:opacity-60"
      >
        {isPending ? tr("Opening…") : tr("Card or bank details")}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </div>
  );
}
