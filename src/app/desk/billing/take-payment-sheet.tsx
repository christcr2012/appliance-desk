"use client";
// AR-3 (MONEY-AREA 4): "Take payment" opens the existing payment-link panel in a sheet, in place —
// the Bills list, the customer record and the bill record all use this instead of navigating away.
// The old #take-payment anchor keeps working: a bill record that renders this with anchorId opens
// the sheet when the page is reached through that anchor.
import { useEffect, useState } from "react";
import { Sheet } from "@/components/kit/sheet";
import { actionButtonClass } from "@/components/kit/action-button";
import { PaymentLinkPanel } from "@/components/desk/payment-link-panel";
import { formatMoney } from "@/lib/money-ui";
import type { PaymentLinkReason } from "@/domains/billing/payment-link-message";

/** The sheet itself, for wrappers that open it from their own controls (the customer record's header link). */
export function TakePaymentSheetControlled({
  invoiceId,
  owedCents,
  suggestedReason,
  open,
  onOpenChange,
}: {
  invoiceId: string;
  owedCents: number;
  suggestedReason: PaymentLinkReason;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={`Take payment · ${formatMoney(owedCents)}`}>
      <PaymentLinkPanel invoiceId={invoiceId} suggestedReason={suggestedReason} />
    </Sheet>
  );
}

export function TakePaymentSheet({
  invoiceId,
  owedCents,
  suggestedReason,
  label = "Take payment",
  variant = "secondary",
  anchorId,
}: {
  invoiceId: string;
  owedCents: number;
  suggestedReason: PaymentLinkReason;
  label?: string;
  variant?: "primary" | "secondary";
  anchorId?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!anchorId) return;
    const check = () => {
      if (window.location.hash === "#take-payment") setOpen(true);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, [anchorId]);
  return (
    <>
      <button
        type="button"
        id={anchorId}
        onClick={() => setOpen(true)}
        className={actionButtonClass({ spec: { kind: "link", label, href: "#take-payment" }, variant })}
      >
        {label}
      </button>
      <TakePaymentSheetControlled
        invoiceId={invoiceId}
        owedCents={owedCents}
        suggestedReason={suggestedReason}
        open={open}
        onOpenChange={setOpen}
      />
    </>
  );
}
