// AR-3 (MONEY-AREA 2): Money › Payments — every payment in one list. Received / Failed / Needs a decision
// read from payments-list; Deposits and Waiting for Stripe render their existing tabs unchanged.
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import { getPaymentCounts, getPayments, type PaymentRow } from "@/domains/billing/payments-list";
import { PAYMENT_METHODS, paymentMethodWord, paymentPill } from "@/domains/billing/payment-tabs";
import { HELD_CONFLICT_STATUS, HELD_PAYMENT_STATUS } from "@/domains/billing/payment-status";
import {
  ActionButton,
  ActiveFilterChips,
  DataTable,
  EmptyState,
  ScreenHeader,
  StatusPill,
  StatusTabs,
  Toolbar,
  type Column,
  type FilterDef,
  type MenuItem,
} from "@/components/kit";
import { DepositsTab } from "../billing/deposits-tab";
import { WaitingTab } from "../billing/waiting-tab";
import { parsePaymentsParams, paymentsHref, PAYMENT_SORT_LABEL } from "./params";

export const metadata = { title: "Payments" };

type Search = Record<string, string | string[] | undefined>;

const FILTERS: FilterDef[] = [
  {
    kind: "multi",
    param: "method",
    label: "Method",
    options: PAYMENT_METHODS.map((method) => ({ value: method, label: paymentMethodWord(method) })),
  },
  { kind: "date", param: "when", label: "When" },
];

const SORTS = (Object.keys(PAYMENT_SORT_LABEL) as (keyof typeof PAYMENT_SORT_LABEL)[]).map((value) => ({
  value,
  label: PAYMENT_SORT_LABEL[value],
}));

const EMPTY_TITLE = { received: "No payments yet", failed: "No failed payments", held: "Nothing needs a decision" } as const;

function primaryAction(row: PaymentRow) {
  if (row.status === HELD_PAYMENT_STATUS)
    return <ActionButton spec={{ kind: "link", label: "Decide…", href: "/desk/billing/held-payments" }} />;
  if (row.status === HELD_CONFLICT_STATUS)
    return <ActionButton spec={{ kind: "link", label: "Check…", href: "/desk/billing/reconciliation" }} />;
  return null;
}

const billHref = (row: PaymentRow) => `/desk/billing/customer/${row.customerId}/invoice/${row.invoiceId}`;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole("OWNER", "ADMIN");
  const params = parsePaymentsParams(await searchParams);
  const now = new Date();
  const counts = await getPaymentCounts(params, now);

  const tabs = (
    <StatusTabs
      label="Payment status"
      current={params.status}
      items={[
        { value: "received", label: "Received", count: counts.received },
        { value: "failed", label: "Failed", count: counts.failed, hideWhenZero: true },
        { value: "held", label: "Needs a decision", count: counts.held, hideWhenZero: true },
        { value: "deposits", label: "Deposits" },
        { value: "waiting", label: "Waiting for Stripe" },
      ]}
    />
  );

  if (params.status === "deposits" || params.status === "waiting") {
    return (
      <div className="flex flex-col gap-4">
        <ScreenHeader title="Payments" />
        {tabs}
        {params.status === "deposits" ? <DepositsTab /> : <WaitingTab />}
      </div>
    );
  }

  const { rows, nextCursor, capped } = await getPayments(params, now);
  const tab = params.status;

  const columns: Column<PaymentRow>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (row) => (
        <span className="font-bold text-ink">
          {row.customerName}
          {row.companyName ? <span className="block text-sm font-normal text-ink-soft">{row.companyName}</span> : null}
        </span>
      ),
    },
    { key: "bill", header: "Bill", cell: (row) => `Bill #${row.invoiceNumber}` },
    { key: "method", header: "Method", cell: (row) => paymentMethodWord(row.method) },
    { key: "date", header: "Date", cell: (row) => formatShortDate(row.createdAt, now) },
    { key: "amount", header: "Amount", align: "right", cell: (row) => formatMoney(row.amountCents) },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const pill = paymentPill(row.status);
        return (
          <span className="flex flex-col items-start gap-1">
            <StatusPill label={pill.label} tone={pill.tone} info={pill.info} />
            {row.status === "failed" || row.status === "FAILED" ? (
              row.failureReason ? <span className="text-xs text-ink-soft">{row.failureReason}</span> : null
            ) : row.status === HELD_CONFLICT_STATUS ? (
              <span className="text-xs text-ink-soft">Refunded in Stripe after it was used as credit</span>
            ) : null}
          </span>
        );
      },
    },
    { key: "action", header: "", cell: (row) => primaryAction(row) },
  ];

  const rowActions = (row: PaymentRow): MenuItem[] => [
    { kind: "link", label: "Open customer", href: `/desk/customers/${row.customerId}` },
  ];

  return (
    // The kit lays out for a 20 px phone gutter (KIT 1); the current shell gives 16 px, so add the difference (same as the Bills list).
    <div className="flex flex-col gap-4 px-1 sm:px-0">
      <ScreenHeader title="Payments" />
      {tabs}
      <Toolbar
        search={{ param: "q", placeholder: "Name or bill number", label: "Search payments" }}
        filters={FILTERS}
        sorts={SORTS}
        currentSort={params.sort}
      />
      <ActiveFilterChips filters={FILTERS} />
      {tab === "received" ? (
        <p className="text-sm font-bold text-ink-soft tabular-nums">
          {counts.received} payments · {formatMoney(counts.receivedSumCents)}
        </p>
      ) : null}
      <DataTable<PaymentRow>
        caption="Payments"
        rows={rows}
        rowKey={(row) => row.id}
        columns={columns}
        rowHref={billHref}
        rowActions={rowActions}
        mobileCardLink={false}
        mobileCard={(row) => {
          const pill = paymentPill(row.status);
          return (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-3">
                <Link href={billHref(row)} className="font-bold text-ink hover:underline">
                  {row.customerName}
                </Link>
                <span className="font-extrabold text-ink tabular-nums">{formatMoney(row.amountCents)}</span>
              </div>
              <p className="text-sm text-ink-soft">
                Bill #{row.invoiceNumber} · {paymentMethodWord(row.method)} · {formatShortDate(row.createdAt, now)}
              </p>
              <div className="flex items-center justify-between gap-3">
                <StatusPill label={pill.label} tone={pill.tone} info={pill.info} />
                {primaryAction(row)}
              </div>
            </div>
          );
        }}
        empty={<EmptyState title={EMPTY_TITLE[tab]} />}
        nextHref={nextCursor ? paymentsHref(params, nextCursor) : null}
        capReached={capped}
      />
    </div>
  );
}
