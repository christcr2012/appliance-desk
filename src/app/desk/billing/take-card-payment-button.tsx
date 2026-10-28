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
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        disabled={pending}
        className={actionButtonClass({ spec: { kind: "link", label, href: "#" }, variant })}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await startSaleCardPaymentAction(invoiceId);
            if (r.status === "error") return setError(r.message);
            window.open(r.url, "_blank", "noopener,noreferrer");
          })
        }
      >
        {label}
      </button>
      {error ? (
        <span role="alert" className="text-sm font-medium text-danger">
          {error}
        </span>
      ) : null}
    </span>
  );
}
