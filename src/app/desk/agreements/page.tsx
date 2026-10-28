import type { Metadata } from "next";
import { requireRole } from "@/lib/session";
import {
  getRentals,
  getRentalCounts,
  type OwnerRentalRow,
  type StaffRentalRow,
} from "@/domains/agreements/rentals-list";
import { isReservationStale } from "@/domains/agreements/reservation-status";
import { describeRentalLine } from "@/domains/portal/line-display";
import { AGREEMENT_PILL } from "@/domains/customers/record";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import {
  AutoRefresh,
  DataTable,
  EmptyState,
  PullToRefresh,
  ScreenHeader,
  StatusPill,
  StatusTabs,
  Toaster,
  Toolbar,
  type Column,
  type FilterDef,
  type MenuItem,
} from "@/components/kit";
import { builtInViewsFor } from "@/components/kit/built-in-views";
import { parseRentalsParams, rentalsHref } from "./params";

export const metadata: Metadata = { title: "Rentals" };

type Search = Record<string, string | string[] | undefined>;
type Row = OwnerRentalRow | StaffRentalRow;

const FILTERS: FilterDef[] = [
  {
    kind: "select",
    param: "starts",
    label: "Starts",
    options: [
      { value: "this-week", label: "This week" },
      { value: "this-month", label: "This month" },
    ],
  },
  {
    kind: "select",
    param: "ends",
    label: "Ends",
    options: [
      { value: "this-week", label: "This week" },
      { value: "this-month", label: "This month" },
      { value: "ending-soon", label: "Ending soon" },
    ],
  },
];

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "ends-soonest", label: "Ending soonest" },
  { value: "rent-desc", label: "Highest rent" },
  { value: "customer-asc", label: "Customer A–Z" },
];

function detailLine(row: Row, now: Date): string {
  if (isReservationStale(row.status, row.reservationExpiresAt, now)) {
    return `Hold ends ${formatShortDate(row.reservationExpiresAt as Date, now)}`;
  }
  if (row.termMonths == null) {
    if (row.status === "ACTIVE" || row.status === "SCHEDULED") return "Month to month";
    return "";
  }
  if (row.endDate) return `Ends ${formatShortDate(row.endDate, now)}`;
  return "";
}

function rowActions(row: Row): MenuItem[] {
  const items: MenuItem[] = [
    { kind: "link", label: "Open", href: `/desk/agreements/${row.id}` },
    { kind: "link", label: "View customer", href: `/desk/customers/${row.customerId}` },
    {
      kind: "link",
      label: "Schedule a visit",
      href: `/desk/jobs/new?agreementId=${row.id}`,
    },
  ];
  if (row.status === "ACTIVE") {
    items.push({
      kind: "link",
      label: "End this rental…",
      href: `/desk/agreements/${row.id}?end=1`,
    });
  }
  return items;
}

export default async function RentalsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = session.user.role as "OWNER" | "ADMIN" | "STAFF";
  const params = parseRentalsParams(await searchParams);
  const now = new Date();
  const [list, counts] = await Promise.all([
    getRentals(params, now),
    getRentalCounts(params, now),
  ]);
  const canViewMoney = !list.staff;
  const tabs = [
    { value: "active", label: "Active", count: counts.active },
    {
      value: "signing",
      label: "Waiting for signature",
      count: counts.signing,
      hideWhenZero: true,
    },
    { value: "starting", label: "Starting", count: counts.starting, hideWhenZero: true },
    { value: "drafts", label: "Drafts", count: counts.drafts, hideWhenZero: true },
    { value: "ended", label: "Ended" },
    { value: "cancelled", label: "Cancelled" },
  ];
  const filtered = Boolean(params.q || params.starts || params.ends);
  const columns: Column<Row>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (row) => row.customerName,
      sortValue: "customer-asc",
    },
    {
      key: "address",
      header: "Address",
      cell: (row) => (row.addressLine1 ? `${row.addressLine1}, ${row.city ?? ""}` : ""),
    },
    {
      key: "rental",
      header: "Rental",
      cell: (row) => row.lines.map(describeRentalLine).join(" + "),
    },
    {
      key: "rent",
      header: "Monthly rent",
      align: "right",
      cell: (row) =>
        "monthlyCents" in row && row.monthlyCents !== undefined
          ? formatMoney(row.monthlyCents)
          : "",
      sortValue: "rent-desc",
    },
    {
      key: "ends",
      header: "Ends",
      cell: (row) => detailLine(row, now),
      sortValue: "ends-soonest",
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const pill = AGREEMENT_PILL[row.status](row.startDate, now);
        return <StatusPill label={pill.label} tone={pill.tone} />;
      },
    },
  ];

  return (
    <PullToRefresh>
      <div className="px-1 sm:px-0">
        <ScreenHeader
          title="Customers"
          list
          primary={{
            kind: "link",
            label: "New rental",
            href: "/desk/agreements/new",
            primary: true,
          }}
        />
        <AutoRefresh />
        <Toaster />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <StatusTabs label="Rental status" current={params.status} items={tabs} />
          <div className="min-w-0 flex-1">
            <Toolbar
              search={{
                param: "q",
                placeholder: "Name, address or appliance number",
                label: "Search rentals",
              }}
              filters={FILTERS}
              sorts={SORTS}
              currentSort={params.sort}
              views={builtInViewsFor("rentals", { role })}
            />
          </div>
        </div>
        <div className="mt-2">
          <DataTable
            caption="Rentals"
            rows={list.rows}
            rowKey={(row) => row.id}
            columns={columns}
            rowHref={(row) => `/desk/agreements/${row.id}`}
            rowActions={rowActions}
            currentSort={params.sort}
            mobileCard={(row) => {
              const pill = AGREEMENT_PILL[row.status](row.startDate, now);
              const detail = detailLine(row, now);
              return (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-ink">{row.customerName}</span>
                    <StatusPill label={pill.label} tone={pill.tone} />
                  </div>
                  {row.addressLine1 ? (
                    <span className="text-sm text-ink-soft">
                      {row.addressLine1}, {row.city ?? ""}
                    </span>
                  ) : null}
                  <span className="text-sm text-ink-soft">
                    {row.lines.map(describeRentalLine).join(" + ")}
                  </span>
                  <span className="flex items-center justify-between text-sm text-ink-soft">
                    <span>{detail}</span>
                    {canViewMoney && "monthlyCents" in row ? (
                      <span className="font-semibold text-ink">
                        {formatMoney(row.monthlyCents ?? 0)}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            }}
            empty={
              filtered ? (
                <EmptyState
                  title="No rentals here"
                  action={{
                    kind: "link",
                    label: "Clear filters",
                    href: `/desk/agreements?status=${params.status}`,
                  }}
                />
              ) : (
                <EmptyState title="No rentals here" />
              )
            }
            nextHref={list.nextCursor ? rentalsHref(params, { cursor: list.nextCursor }) : null}
            capReached={list.capped}
          />
        </div>
      </div>
    </PullToRefresh>
  );
}
