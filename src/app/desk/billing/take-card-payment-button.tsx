"use client";
// AR-3 (MONEY-AREA 4): the shop-card path — "Take card payment" starts the existing sale card payment
// and opens the returned Stripe page in a new tab, with its own error text on failure.
import { useState, useTransition } from "react";
import { actionButtonClass } from "@/components/kit/action-button";
import { startSaleCardPaymentAction } from "@/app/desk/sales/actions";

export function TakeCardPaymentButton({
  invoiceId,
  label = "Take card payment",
  variant = "primary",
}: {
  invoiceId: string;
  label?: string;
  variant?: "primary" | "secondary";
}) {
  const [error, setError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={actionButtonClass({ spec: { kind: "link", label, href: "#" }, variant })}
        onClick={() => {
          // Reserve the tab synchronously inside the click: opening it after the await loses the
          // click's user activation and popup blockers (notably Safari) can swallow the payment
          // page after the checkout session was already created.
          const tab = window.open("about:blank", "_blank");
          start(async () => {
            setError(null);
            setFallbackUrl(null);
            const r = await startSaleCardPaymentAction(invoiceId);
            if (r.status === "error") {
              tab?.close();
              return setError(r.message);
            }
            if (tab) tab.location.href = r.url;
            else setFallbackUrl(r.url);
          });
        }}
      >
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-sm font-medium text-danger">
          {error}
        </span>
      ) : null}
      {fallbackUrl ? (
        <a href={fallbackUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-info underline">
          Open the card payment page
        </a>
      ) : null}
    </span>
  );
}
