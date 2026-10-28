"use client";
// AR-3 (MONEY-AREA 3): the bill record's actions — the primary/secondary buttons (which ones comes from
// the pure billActions table) and the ⋯ menu. Menu items that open a sheet render the existing panels
// and forms inside it; those forms keep their own confirmation steps.
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/kit/icons";
import { Sheet } from "@/components/kit/sheet";
import { PrintDocumentButton } from "@/components/print-document-button";
import { TakePaymentSheet } from "@/app/desk/billing/take-payment-sheet";
import { RecordPaymentSheet } from "@/app/desk/billing/record-payment-sheet";
import { TakeCardPaymentButton } from "@/app/desk/billing/take-card-payment-button";
import type { BillRecordActions } from "@/domains/billing/bill-actions";
import type { PaymentLinkReason } from "@/domains/billing/payment-link-message";

const ITEM =
  "flex min-h-11 w-full cursor-pointer select-none items-center rounded-field px-3 text-[15px] font-semibold outline-none data-[highlighted]:bg-tint lg:min-h-10";

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
      {actions.primary === "print" ? <PrintDocumentButton label="Print" /> : null}
      {actions.secondary === "record" ? (
        <RecordPaymentSheet customerId={record.customerId} openInvoices={record.openInvoices} lockedInvoice={record.lockedInvoice} />
      ) : null}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label="More for this bill"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-field border border-line-strong bg-surface text-ink hover:bg-tint lg:min-h-10 lg:min-w-10"
        >
          <Icon name="more" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-56 rounded-card border border-line bg-surface p-1.5 shadow-raise"
          >
            {overflow.sendText ? (
              <DropdownMenu.Item className={ITEM} onSelect={() => setSheet("text")}>
                Send a text…
              </DropdownMenu.Item>
            ) : null}
            {overflow.useCredit ? (
              <DropdownMenu.Item className={ITEM} onSelect={() => setSheet("credit")}>
                Use the customer&apos;s credit…
              </DropdownMenu.Item>
            ) : null}
            {overflow.refund ? (
              <DropdownMenu.Item className={ITEM} onSelect={() => setSheet("refund")}>
                Refund money…
              </DropdownMenu.Item>
            ) : null}
            {overflow.giveUp ? (
              <DropdownMenu.Item className={`${ITEM} text-danger`} onSelect={() => setSheet("giveup")}>
                Give up on this bill…
              </DropdownMenu.Item>
            ) : null}
            {overflow.print ? (
              <DropdownMenu.Item
                className={ITEM}
                onSelect={(event) => {
                  event.preventDefault();
                  window.print();
                }}
              >
                Print
              </DropdownMenu.Item>
            ) : null}
            {overflow.frozen ? (
              <DropdownMenu.Item asChild>
                <Link className={ITEM} href={frozenHref} target="_blank">
                  Frozen bill record
                </Link>
              </DropdownMenu.Item>
            ) : null}
            <DropdownMenu.Item asChild>
              <Link className={ITEM} href={customerHref}>
                View customer
              </Link>
            </DropdownMenu.Item>
            <DropdownMenu.Item asChild>
              <Link className={ITEM} href={statementHref}>
                View statement
              </Link>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>

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
