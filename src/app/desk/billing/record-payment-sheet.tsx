"use client";
// AR-3 (MONEY-AREA 4): "Record cash or check" opens the existing record-payment form in a sheet.
// With lockedInvoice the form applies the money to that one bill only (see RecordPaymentForm).
import { useState } from "react";
import { Sheet, toast } from "@/components/kit";
import { actionButtonClass } from "@/components/kit/action-button";
import { formatMoney } from "@/lib/money-ui";
import { RecordPaymentForm } from "./customer/[id]/record-payment-form";

export function RecordPaymentSheet({
  customerId,
  openInvoices,
  lockedInvoice,
  label = "Record cash or check",
  variant = "secondary",
  anchorId,
}: {
  customerId: string;
  openInvoices: { id: string; invoiceNumber: number; balanceCents: number }[];
  lockedInvoice?: { id: string; invoiceNumber: number };
  label?: string;
  variant?: "primary" | "secondary";
  anchorId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        id={anchorId}
        onClick={() => setOpen(true)}
        className={actionButtonClass({ spec: { kind: "link", label, href: "#record-payment" }, variant })}
      >
        {label}
      </button>
      <Sheet open={open} onOpenChange={setOpen} title="Record cash or check">
        <RecordPaymentForm
          customerId={customerId}
          openInvoices={openInvoices}
          lockedInvoiceId={lockedInvoice}
          variant="sheet"
          onRecorded={(result) => {
            setOpen(false);
            toast({
              message:
                `Recorded ${formatMoney(result.totalAppliedCents)}` +
                (result.overpaymentCents > 0 ? ` · ${formatMoney(result.overpaymentCents)} kept as credit` : ""),
              tone: "good",
            });
          }}
        />
      </Sheet>
    </>
  );
}
