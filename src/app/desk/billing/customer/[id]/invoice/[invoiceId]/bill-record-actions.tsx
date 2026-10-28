"use client";
// AR-3 (MONEY-AREA 3): the bill record's actions — the primary/secondary buttons (which ones comes from
// the pure billActions table) and the ⋯ menu. Menu items that open a sheet render the existing panels
// and forms inside it; those forms keep their own confirmation steps.
import { useEffect, useState, type ReactNode } from "react";
import { ActionMenu, type ActionMenuItem } from "@/components/kit";
import { Sheet } from "@/components/kit/sheet";
import { PrintDocumentButton } from "@/components/print-document-button";
import { TakePaymentSheet } from "@/app/desk/billing/take-payment-sheet";
import { RecordPaymentSheet } from "@/app/desk/billing/record-payment-sheet";
import { TakeCardPaymentButton } from "@/app/desk/billing/take-card-payment-button";
import type { BillRecordActions } from "@/domains/billing/bill-actions";
import type { PaymentLinkReason } from "@/domains/billing/payment-link-message";

type SheetKind = "text" | "credit" | "refund" | "giveup" | null;

export function BillRecordActionsBar({
  actions,
  takePayment,
  record,
  frozenHref,
  customerHref,
  statementHref,
  textPanel,
  creditForm,
  refundForm,
  writeOff,
}: {
  actions: BillRecordActions;
  takePayment: { invoiceId: string; owedCents: number; suggestedReason: PaymentLinkReason } | null;
  record: {
    customerId: string;
    openInvoices: { id: string; invoiceNumber: number; balanceCents: number }[];
    lockedInvoice: { id: string; invoiceNumber: number };
  };
  frozenHref: string;
  customerHref: string;
  statementHref: string;
  textPanel: ReactNode;
  creditForm: ReactNode;
  refundForm: ReactNode;
  writeOff: ReactNode;
}) {
  const [sheet, setSheet] = useState<SheetKind>(null);
  useEffect(() => {
    const check = () => {
      if (window.location.hash === "#send-text") setSheet("text");
    };
    check();
    window.addEventListener("hashchange", check);
    return () => window.removeEventListener("hashchange", check);
  }, []);

  const overflow = actions.overflow;
  const menuItems: ActionMenuItem[] = [
    ...(overflow.sendText ? [{ label: "Send a text…", onSelect: () => setSheet("text") } as ActionMenuItem] : []),
    ...(overflow.useCredit ? [{ label: "Use the customer's credit…", onSelect: () => setSheet("credit") } as ActionMenuItem] : []),
    ...(overflow.refund ? [{ label: "Refund money…", onSelect: () => setSheet("refund") } as ActionMenuItem] : []),
    ...(overflow.giveUp ? [{ label: "Give up on this bill…", danger: true, onSelect: () => setSheet("giveup") } as ActionMenuItem] : []),
    ...(overflow.print ? [{ label: "Print", onSelect: () => window.print() } as ActionMenuItem] : []),
    ...(overflow.frozen ? [{ label: "Frozen bill record", href: frozenHref, external: true } as ActionMenuItem] : []),
    { label: "View customer", href: customerHref },
    { label: "View statement", href: statementHref },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      {actions.primary === "take-payment" && takePayment ? (
        <TakePaymentSheet
          invoiceId={takePayment.invoiceId}
          owedCents={takePayment.owedCents}
          suggestedReason={takePayment.suggestedReason}
          variant="primary"
          anchorId="take-payment"
        />
      ) : null}
      {actions.primary === "take-card" && takePayment ? <TakeCardPaymentButton invoiceId={takePayment.invoiceId} /> : null}
      {actions.primary === "record" ? (
        <RecordPaymentSheet
          customerId={record.customerId}
          openInvoices={record.openInvoices}
          lockedInvoice={record.lockedInvoice}
          variant="primary"
        />
      ) : null}
      {/* Print is the primary action for finished bills (per the spec's table) and stays visible
          for open bills too — the old bill record always showed it next to the header actions. */}
      <PrintDocumentButton />
      {actions.secondary === "record" ? (
        <RecordPaymentSheet customerId={record.customerId} openInvoices={record.openInvoices} lockedInvoice={record.lockedInvoice} />
      ) : null}

      <ActionMenu label="More for this bill" items={menuItems} />

      <Sheet open={sheet === "text"} onOpenChange={(open) => setSheet(open ? "text" : null)} title="Send a text">
        {textPanel}
      </Sheet>
      <Sheet open={sheet === "credit"} onOpenChange={(open) => setSheet(open ? "credit" : null)} title="Use the customer's credit">
        {creditForm}
      </Sheet>
      <Sheet open={sheet === "refund"} onOpenChange={(open) => setSheet(open ? "refund" : null)} title="Refund money">
        {refundForm}
      </Sheet>
      <Sheet open={sheet === "giveup"} onOpenChange={(open) => setSheet(open ? "giveup" : null)} title="Give up on this bill">
        {writeOff}
      </Sheet>
    </div>
  );
}
