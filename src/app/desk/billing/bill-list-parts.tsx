// AR-0b: how one bill looks in a list — the phone card, the desktop columns and the ⋯ menu. Shared by Money › Bills
// and the customer record's Bills section so a bill reads and acts the same in both places. Every button is a link to
// the existing bill pages; nothing here moves money.
import Link from "next/link";
import { StatusPill, type Column, type MenuItem } from "@/components/kit";
import { billPill, billPillInfo } from "@/domains/billing/bill-status";
import type { BillRow } from "@/domains/billing/bills-list";
import { suggestPaymentLinkReason } from "@/domains/billing/payment-link-message";
import { formatMoney } from "@/lib/money-ui";
import { billNext } from "@/lib/status-next";
import { formatShortDate } from "@/lib/business-date";
import { TakePaymentSheet } from "./take-payment-sheet";
import { RecordPaymentSheet } from "./record-payment-sheet";
import { TakeCardPaymentButton } from "./take-card-payment-button";

const enc = encodeURIComponent;
export const billHref = (row: Pick<BillRow, "id" | "customerId">) => `/desk/billing/customer/${enc(row.customerId)}/invoice/${enc(row.id)}`;
const statementHref = (row: Pick<BillRow, "customerId">) => `/desk/billing/customer/${enc(row.customerId)}`;
const FINISHED = new Set(["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"]);

/**
 * AR-3 (MONEY-AREA 4): the main way to collect this bill, as in-place controls — which one comes only from
 * payPathFor. STRIPE_LINK opens the Take payment sheet; SHOP_CARD starts the sale card payment; MANUAL_ONLY
 * opens the Record cash or check sheet locked to this bill. Nothing when there is nothing to collect
 * (including BILL-1: a bank payment is being confirmed, so no button, ⋯ only).
 */
export function BillPayButtons({ row }: { row: BillRow }) {
  if (row.beingConfirmed || !row.payPath) return null;
  switch (row.payPath) {
    case "STRIPE_LINK": {
      const suggestedReason = suggestPaymentLinkReason({ status: row.status, amountPaidCents: row.paidCents });
      return (
        <div className="flex flex-wrap gap-2">
          <TakePaymentSheet invoiceId={row.id} owedCents={row.owedCents} suggestedReason={suggestedReason} variant="primary" />
          <TakePaymentSheet invoiceId={row.id} owedCents={row.owedCents} suggestedReason={suggestedReason} label="Send reminder" />
        </div>
      );
    }
    case "SHOP_CARD":
      return <TakeCardPaymentButton invoiceId={row.id} />;
    case "MANUAL_ONLY":
      return (
        <RecordPaymentSheet
          customerId={row.customerId}
          openInvoices={[{ id: row.id, invoiceNumber: row.number, balanceCents: row.owedCents }]}
          lockedInvoice={{ id: row.id, invoiceNumber: row.number }}
          variant="primary"
        />
      );
  }
}

export function billRowActions(row: BillRow): MenuItem[] {
  const items: MenuItem[] = [];
  const open = row.payPath !== null || (row.status === "FAILED" && row.owedCents > 0);
  if (row.payPath === "STRIPE_LINK" && !row.beingConfirmed) items.push({ kind: "link", label: "Take payment", href: `${billHref(row)}#take-payment` });
  if (row.payPath === "SHOP_CARD" && !row.beingConfirmed) items.push({ kind: "link", label: "Take card payment", href: `/desk/sales/${enc(row.id)}` });
  if (open) items.push({ kind: "link", label: "Record cash or check", href: `${statementHref(row)}#record-payment` });
  items.push({ kind: "link", label: "View customer", href: `/desk/customers/${enc(row.customerId)}` });
  if (FINISHED.has(row.status)) items.push({ kind: "link", label: "Frozen bill record", href: `/api/documents/invoice/${enc(row.id)}` });
  if (open && row.status !== "WRITTEN_OFF") {
    items.push({ kind: "link", label: "Give up on this bill…", href: `${statementHref(row)}#bill-${enc(row.id)}`, danger: true });
  }
  return items;
}

function detailLine(row: BillRow): string | null {
  // BILL-1: "$120.00 by bank · started Oct 22" — the bank is confirming it, so there is nothing to do.
  if (row.confirming) return `${formatMoney(row.confirming.amountCents)} by bank · started ${formatShortDate(row.confirming.startedAt)}`;
  if (row.status === "PARTIALLY_PAID") return `Paid ${formatMoney(row.paidCents)} of ${formatMoney(row.amountCents)}`;
  if (row.status === "FAILED") return "This bill has an old status — open it to check";
  return null;
}

/** Open tabs show what is still owed; finished tabs show the bill's amount. */
export function billMobileCard(row: BillRow, now: Date, owing: boolean) {
  const pill = billPill({ status: row.status, dueDate: row.dueDate, amountDueCents: row.amountCents, amountPaidCents: row.paidCents, beingConfirmed: row.beingConfirmed }, now);
  const detail = detailLine(row);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {/* A customer with no name shows their email, which has no spaces: let it wrap anywhere on a phone. */}
          <h3 className="text-base font-bold text-ink [overflow-wrap:anywhere]">
            <Link href={billHref(row)} className="hover:underline">
              {row.customerName}
            </Link>
          </h3>
          <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">
            {row.forText} · Bill #{row.number}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-base font-extrabold text-ink tabular-nums">{formatMoney(owing ? row.owedCents : row.amountCents)}</span>
          <StatusPill label={pill.label} tone={pill.tone} info={billPillInfo(row.status, row.beingConfirmed)} next={billNext({ status: row.status, dueDate: row.dueDate, amountDueCents: row.amountCents, amountPaidCents: row.paidCents, beingConfirmed: row.beingConfirmed }, now)} />
        </div>
      </div>
      {detail ? <p className="text-sm text-ink-soft">{detail}</p> : null}
      <BillPayButtons row={row} />
    </div>
  );
}

export function billColumns(now: Date): Column<BillRow>[] {
  return [
    {
      key: "customer",
      header: "Customer",
      sortValue: "customer-asc",
      cell: (row) => <span className="font-bold text-ink">{row.customerName}</span>,
    },
    { key: "number", header: "Bill", cell: (row) => `#${row.number}` },
    { key: "for", header: "For", cell: (row) => row.forText, desktopOnly: true },
    { key: "amount", header: "Amount", align: "right", cell: (row) => formatMoney(row.amountCents) },
    {
      key: "owed",
      header: "Still owed",
      align: "right",
      sortValue: "owed-desc",
      cell: (row) => <span className="font-extrabold">{formatMoney(row.owedCents)}</span>,
    },
    {
      key: "status",
      header: "Status",
      sortValue: "due-asc",
      cell: (row) => {
        const pill = billPill({ status: row.status, dueDate: row.dueDate, amountDueCents: row.amountCents, amountPaidCents: row.paidCents, beingConfirmed: row.beingConfirmed }, now);
        return <StatusPill label={pill.label} tone={pill.tone} info={billPillInfo(row.status, row.beingConfirmed)} next={billNext({ status: row.status, dueDate: row.dueDate, amountDueCents: row.amountCents, amountPaidCents: row.paidCents, beingConfirmed: row.beingConfirmed }, now)} />;
      },
    },
  ];
}
