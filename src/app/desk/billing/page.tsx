import Link from "next/link";
import { redirect } from "next/navigation";
import { getCustomersWithOpenBalances } from "@/domains/billing";
import { billPill, billPillInfo } from "@/domains/billing/bill-status";
import { getBillCounts, getBills, getBillTotals, type BillRow } from "@/domains/billing/bills-list";
import { getInvoiceDetail, type InvoiceDetail } from "@/domains/billing/invoice-detail";
import { SUCCESSFUL_PAYMENT_STATUSES } from "@/domains/billing/payment-status";
import { requireRole } from "@/lib/session";
import { businessDayBounds, formatBusinessDate } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";
import { formatCents } from "@/domains/pricing";
import { DataList, EmptyState as LegacyEmptyState, StatusPill as LegacyStatusPill, type DataListColumn } from "@/components/ui";
import {
  ActionButton,
  ActiveFilterChips,
  DataTable,
  EmptyState,
  OverflowMenu,
  ScreenHeader,
  SidePanel,
  StatusPill,
  StatusTabs,
  Timeline,
  Toaster,
  Toolbar,
  type FilterDef,
  type TimelineItem,
  type ViewDef,
} from "@/components/kit";
import { BILL_SORT_LABEL, hasBillFilters, legacyBillsRedirect, parseBillsParams, type BillsPageParams } from "./params";
import { billColumns, billHref, billMobileCard, billPayActions, billRowActions } from "./bill-list-parts";
import { DepositsTab } from "./deposits-tab";
import { WaitingTab } from "./waiting-tab";

export const metadata = { title: "Bills" };

type Search = Record<string, string | string[] | undefined>;
type BalanceRow = Awaited<ReturnType<typeof getCustomersWithOpenBalances>>[number];

const FILTERS: FilterDef[] = [
  {
    kind: "multi",
    param: "type",
    label: "Type",
    options: [
      { value: "rent", label: "Rental bills" },
      { value: "sale", label: "Shop sales" },
      { value: "other", label: "Other" },
    ],
  },
  { kind: "date", param: "due", label: "Due date" },
  {
    kind: "select",
    param: "autopay",
    label: "Autopay",
    options: [
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ],
  },
];

const VIEWS: ViewDef[] = [
  { id: "past-due", label: "Past due", href: "/desk/billing?status=past-due", builtIn: true },
  { id: "by-customer", label: "By customer", href: "/desk/billing?view=by-customer", builtIn: true },
  { id: "deposits", label: "Deposits", href: "/desk/billing?view=deposits", builtIn: true },
  { id: "waiting", label: "Waiting for Stripe", href: "/desk/billing?view=waiting", builtIn: true },
];

const EMPTY: Record<BillsPageParams["status"], string> = {
  open: "No open bills",
  "past-due": "Nothing is late",
  paid: "No paid bills yet",
  closed: "No closed bills",
  drafts: "No draft bills",
};

const balanceColumns: DataListColumn<BalanceRow>[] = [
  {
    key: "customer",
    header: "Customer",
    primary: true,
    cell: (customer) => (
      <div>
        <Link href={`/desk/billing/customer/${customer.id}`} className="font-semibold text-ink underline-offset-4 hover:underline">
          {customer.customerName}
        </Link>
        {customer.isPropertyManager && (
          <span className="mt-2 block">
            <LegacyStatusPill tone="progress" label="Property manager" />
          </span>
        )}
      </div>
    ),
  },
  { key: "properties", header: "Properties", cell: (customer) => String(customer.propertyCount) },
  { key: "invoices", header: "Open bills", cell: (customer) => String(customer.openInvoiceCount) },
  {
    key: "balance",
    header: "Balance owed",
    cell: (customer) => <span className="font-semibold text-warning-ink">{formatCents(customer.balanceCents)}</span>,
  },
];

function hrefWith(params: URLSearchParams, changes: Record<string, string | null>): string {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  const query = next.toString();
  return query ? `/desk/billing?${query}` : "/desk/billing";
}

function BillPanel({ detail, row, closeHref, now }: { detail: InvoiceDetail; row: BillRow | undefined; closeHref: string; now: Date }) {
  const pill = billPill(
    { status: detail.status as BillRow["status"], dueDate: detail.dueDate, amountDueCents: detail.amountDueCents, amountPaidCents: detail.amountPaidCents },
    now,
  );
  const fullHref = `/desk/billing/customer/${encodeURIComponent(detail.customer.id)}/invoice/${encodeURIComponent(detail.id)}`;
  const late = detail.dueDate ? detail.dueDate < businessDayBounds(now).start && detail.balanceCents > 0 : false;
  const manual = (method: string | null) => !!method && !["card", "stripe", "us_bank_account", "link"].includes(method.toLowerCase());
  const timeline: TimelineItem[] = [
    { id: `${detail.id}-created`, at: detail.createdAt, title: "Bill created", tone: "neutral", actor: "automatic" },
    ...detail.payments.map((payment): TimelineItem => {
      const ok = (SUCCESSFUL_PAYMENT_STATUSES as readonly string[]).includes(payment.status);
      const failed = payment.status.toLowerCase() === "failed";
      return {
        id: payment.id,
        at: payment.createdAt,
        title: ok ? `Payment received · ${formatMoney(payment.amountCents)}` : failed ? "Payment failed" : `Payment ${payment.status.toLowerCase()} · ${formatMoney(payment.amountCents)}`,
        tone: ok ? "good" : failed ? "attention" : "neutral",
        actor: manual(payment.method) ? "Recorded by hand" : "automatic",
      };
    }),
  ];
  const actions = row ? billPayActions(row) : [];
  return (
    <SidePanel title={`Bill #${detail.invoiceNumber}`} closeHref={closeHref} fullHref={fullHref}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-bold text-ink-soft">Bill #{detail.invoiceNumber}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <p className="text-lg font-extrabold text-ink">{detail.customer.name}</p>
            <StatusPill label={pill.label} tone={pill.tone} info={billPillInfo(detail.status as BillRow["status"])} />
          </div>
        </div>
        {/* The StatStrip's two-column look, kept at two columns inside the 420 px panel. */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-card border border-line px-4 py-3.5">
          {[
            { label: "Still owed", value: formatMoney(detail.balanceCents), strong: detail.balanceCents > 0 },
            { label: late ? "Was due" : "Due", value: detail.dueDate ? formatBusinessDate(detail.dueDate) : "No due date", strong: false },
            { label: "For", value: row?.forText ?? detail.lineItems[0]?.description ?? "Bill", strong: false },
            { label: "Card on file", value: row?.autopay ? "On file" : "None", strong: false },
          ].map((stat) => (
            <div key={stat.label} className="min-w-0">
              <dt className="text-xs font-bold text-ink-soft">{stat.label}</dt>
              <dd className={`mt-0.5 text-[15px] tabular-nums ${stat.strong ? "font-extrabold text-warning-ink" : "font-bold text-ink"}`}>{stat.value}</dd>
            </div>
          ))}
        </dl>
        {actions.length > 0 || row ? (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((spec, index) => (
              <ActionButton
                key={spec.label}
                spec={spec.label === "Remind" ? { ...spec, label: "Send reminder" } : spec}
                variant={index === 0 ? "primary" : "secondary"}
              />
            ))}
            {row ? <OverflowMenu items={billRowActions(row)} label={`More for bill ${detail.invoiceNumber}`} /> : null}
          </div>
        ) : null}
        <section aria-labelledby="bill-panel-history">
          <h3 id="bill-panel-history" className="text-base font-bold text-ink">
            What happened
          </h3>
          <Timeline items={timeline} emptyLabel="Nothing recorded yet" now={now} />
        </section>
        <Link href={fullHref} className="inline-flex min-h-10 items-center text-[15px] font-bold text-primary hover:underline">
          Open full bill →
        </Link>
      </div>
    </SidePanel>
  );
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<Search> }) {
  await requireRole("OWNER", "ADMIN");
  const search = await searchParams;
  const legacy = legacyBillsRedirect(search);
  if (legacy) redirect(legacy);
  const params = parseBillsParams(search);
  const now = new Date();
  const urlParams = new URLSearchParams(
    Object.entries(search).flatMap(([key, value]) => (typeof value === "string" ? [[key, value]] : Array.isArray(value) && value[0] ? [[key, value[0]]] : [])),
  );

  const header = (
    <ScreenHeader
      title="Money"
      list
      primary={{ kind: "link", label: "New bill", href: "/desk/sales/new", primary: true }}
      overflow={[
        { kind: "link", label: "Held payments", href: "/desk/billing/held-payments" },
        { kind: "link", label: "Check against Stripe", href: "/desk/billing/reconciliation" },
      ]}
    />
  );
  const toolbar = (
    <Toolbar
      search={{ placeholder: "Name or bill number", label: "Search bills" }}
      filters={FILTERS}
      sorts={Object.entries(BILL_SORT_LABEL).map(([value, label]) => ({ value, label }))}
      currentSort={params.sort}
      views={VIEWS}
      currentViewId={params.view ?? (params.status === "past-due" ? "past-due" : undefined)}
    />
  );

  if (params.view) {
    const legacyTitle = params.view === "by-customer" ? "Who owes money" : params.view === "deposits" ? "Deposits" : "Waiting for Stripe";
    const balances = params.view === "by-customer" ? await getCustomersWithOpenBalances() : [];
    return (
      <div className="px-1 sm:px-0">
        {header}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <h2 className="flex-1 text-base font-bold text-ink">{legacyTitle}</h2>
          <ActionButton spec={{ kind: "link", label: "All bills", href: "/desk/billing" }} variant="secondary" />
        </div>
        {params.view === "deposits" ? (
          <DepositsTab />
        ) : params.view === "waiting" ? (
          <WaitingTab />
        ) : (
          <DataList
            rows={balances}
            columns={balanceColumns}
            caption="Who owes money"
            empty={<LegacyEmptyState title="No one owes money right now" />}
          />
        )}
      </div>
    );
  }

  const [list, counts, totals, openDetail] = await Promise.all([
    getBills(params, now),
    getBillCounts(params, now),
    getBillTotals(params, now),
    params.open ? getInvoiceDetail(params.open) : Promise.resolve(null),
  ]);
  const owing = params.status === "open" || params.status === "past-due";
  const filtered = hasBillFilters(params);
  const tabs = [
    { value: "open", label: "Open", count: counts.open },
    { value: "past-due", label: "Past due", count: counts["past-due"] },
    { value: "paid", label: "Paid" },
    { value: "closed", label: "Closed" },
    { value: "drafts", label: "Drafts", count: counts.drafts, hideWhenZero: true },
  ];
  const nextHref = list.nextCursor ? hrefWith(urlParams, { cursor: list.nextCursor }) : null;
  const closeHref = hrefWith(urlParams, { open: null });
  const openRow = params.open ? list.rows.find((row) => row.id === params.open) : undefined;
  const summary = owing
    ? `${totals.count} ${totals.count === 1 ? "bill" : "bills"} · ${formatMoney(totals.owedCents)} still owed`
    : `${totals.count} ${totals.count === 1 ? "bill" : "bills"}`;
  const summaryLine = (
    <p className="flex items-center justify-between gap-3 py-2 text-sm font-semibold text-ink-soft">
      <span>{summary}</span>
      <span>Sort: {BILL_SORT_LABEL[params.sort]}</span>
    </p>
  );

  return (
    // The kit lays out for a 20 px phone gutter (KIT 1); the current shell gives 16 px, so add the difference until AR-1.
    <div className="px-1 sm:px-0">
      {header}
      <Toaster />
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <StatusTabs label="Bill status" current={params.status} items={tabs} />
        <div className="min-w-0 flex-1">{toolbar}</div>
      </div>
      <ActiveFilterChips filters={FILTERS} />
      <div className="lg:hidden">{summaryLine}</div>
      <div className="mt-2 lg:flex lg:items-start lg:gap-0">
        <section aria-label="Bills" className="min-w-0 flex-1">
          <DataTable
            caption="Bills"
            rows={list.rows}
            rowKey={(row) => row.id}
            columns={billColumns(now)}
            mobileCard={(row) => billMobileCard(row, now, owing)}
            mobileCardLink={false}
            rowHref={(row) => billHref(row)}
            selectedKey={params.open}
            rowActions={billRowActions}
            currentSort={params.sort}
            empty={
              filtered ? (
                <EmptyState title="No bills match" action={{ kind: "link", label: "Clear filters", href: hrefWith(new URLSearchParams(), { status: params.status }) }} />
              ) : (
                <EmptyState title={EMPTY[params.status]} />
              )
            }
            nextHref={nextHref}
            capReached={list.capped}
          />
          <div className="hidden lg:block">{list.rows.length > 0 ? summaryLine : null}</div>
        </section>
        {openDetail ? <BillPanel detail={openDetail} row={openRow} closeHref={closeHref} now={now} /> : null}
      </div>
    </div>
  );
}
