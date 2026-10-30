import type { Metadata } from "next";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWorkspace, savedViewHref } from "@/domains/workspace";
import { saveCustomerViewAction } from "@/app/desk/views/actions";
import {
  getCustomerList,
  getCustomerSegmentCounts,
  nextEventText,
  type CustomerListRow,
} from "@/domains/customers/list";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import {
  AutoRefresh,
  DataTable,
  EmptyState,
  PullToRefresh,
  ScreenHeader,
  SidePanel,
  StatStrip,
  StatusPill,
  StatusTabs,
  Toaster,
  Toolbar,
  type Column,
  type FilterDef,
  type MenuItem,
} from "@/components/kit";
import { builtInViewsFor } from "@/components/kit/built-in-views";
import { parseCustomersParams, customersHref } from "./params";
import { exportSelectedCustomersAction } from "./bulk-actions";

export const metadata: Metadata = { title: "Customers" };

type Search = Record<string, string | string[] | undefined>;
type Role = "OWNER" | "ADMIN" | "STAFF";

const SINCE_OPTIONS = [
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "12m", label: "Last 12 months" },
];

/** The segment pill: the first matching rule in the spec's priority order. */
function pillFor(row: CustomerListRow): { label: string; tone: "attention" | "info" | "good" | "neutral" } {
  if (row.segments.includes("owes")) {
    return { label: `Owes ${formatMoney(row.pastDueCents ?? 0)}`, tone: "attention" };
  }
  if (row.segments.includes("ending")) return { label: "Ending soon", tone: "info" };
  if (row.segments.includes("setting-up")) return { label: "Setting up", tone: "info" };
  if (row.segments.includes("active")) return { label: "Active", tone: "good" };
  if (row.segments.includes("past")) return { label: "Past customer", tone: "neutral" };
  return { label: "New", tone: "info" };
}

function sublineFor(row: CustomerListRow): string {
  const parts: string[] = [];
  if (row.companyName && row.name === row.companyName) {
    // The company IS the display name; nothing more to add.
  } else if (row.companyName) {
    parts.push(row.companyName);
  }
  if (row.isPropertyManager) {
    parts.push(
      `Property manager · ${row.propertyCount} ${row.propertyCount === 1 ? "property" : "properties"}`,
    );
  }
  return parts.join(" · ");
}

/** The record page's Take payment destinations, keyed by payPathFor. */
function takePaymentHref(row: CustomerListRow): string | null {
  if (!row.oldestOpenBillId || !row.oldestOpenBillPayPath) return null;
  const bill = encodeURIComponent(row.oldestOpenBillId);
  const customer = encodeURIComponent(row.id);
  if (row.oldestOpenBillPayPath === "SHOP_CARD") return `/desk/sales/${bill}`;
  if (row.oldestOpenBillPayPath === "MANUAL_ONLY") return `/desk/billing/customer/${customer}#record-payment`;
  return `/desk/billing/customer/${customer}/invoice/${bill}#take-payment`;
}

function rowActions(row: CustomerListRow, role: Role): MenuItem[] {
  const ownerOrAdmin = role !== "STAFF";
  const items: MenuItem[] = [];
  if (row.phone) items.push({ kind: "tel", label: "Call", phone: row.phone });
  const pay = ownerOrAdmin ? takePaymentHref(row) : null;
  if (pay) items.push({ kind: "link", label: "Take payment", href: pay });
  items.push({
    kind: "link",
    label: "Schedule a visit",
    href: `/desk/jobs/new?customerId=${encodeURIComponent(row.id)}`,
  });
  if (ownerOrAdmin) {
    items.push({
      kind: "link",
      label: "New quote",
      href: `/desk/estimates/new?customerId=${encodeURIComponent(row.id)}`,
    });
  }
  items.push({ kind: "link", label: "Open", href: `/desk/customers/${row.id}` });
  return items;
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = session.user.role as Role;
  const ownerOrAdmin = role !== "STAFF";
  const raw = await searchParams;
  const now = new Date();
  const params = parseCustomersParams(raw, now);
  const sincePreset = typeof raw.sincePreset === "string" ? raw.sincePreset : undefined;

  const [list, counts, cities, applianceTypes, workspace] = await Promise.all([
    getCustomerList(params, now),
    getCustomerSegmentCounts(params, now),
    prisma.serviceAddress.findMany({
      distinct: ["city"],
      select: { city: true },
      orderBy: { city: "asc" },
    }),
    prisma.applianceType.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    ownerOrAdmin ? getWorkspace(session.user.id) : Promise.resolve(null),
  ]);
  const cityOptions = cities
    .map((c) => c.city)
    .filter(Boolean)
    .map((city) => ({ value: city, label: city }));

  const segment = params.segment ?? "active";
  const tabs = [
    { value: "active", label: "Active", count: counts.active },
    ...(ownerOrAdmin
      ? [{ value: "owes", label: "Owes money", count: counts.owes, hideWhenZero: true }]
      : []),
    { value: "ending", label: "Ending soon", count: counts.ending, hideWhenZero: true },
    { value: "setting-up", label: "Setting up", count: counts["setting-up"], hideWhenZero: true },
    { value: "past", label: "Past" },
    { value: "new", label: "New", count: counts.new, hideWhenZero: true },
  ];

  const filters: FilterDef[] = [
    ...(cityOptions.length
      ? [{ kind: "multi", param: "city", label: "City", options: cityOptions } as FilterDef]
      : []),
    { kind: "toggle", param: "pm", label: "Property managers" },
    ...(ownerOrAdmin
      ? [{ kind: "toggle", param: "autopay", label: "Autopay off" } as FilterDef]
      : []),
    { kind: "toggle", param: "service", label: "Has an open repair" },
    ...(applianceTypes.length
      ? [
          {
            kind: "multi",
            param: "appliance",
            label: "Appliance type",
            options: applianceTypes.map((t) => ({ value: t.id, label: t.name })),
          } as FilterDef,
        ]
      : []),
    { kind: "select", param: "sincePreset", label: "Customer since", options: SINCE_OPTIONS },
  ];

  const sorts = [
    { value: "attention", label: "Needs attention" },
    { value: "name", label: "Name A–Z" },
    ...(ownerOrAdmin
      ? [
          { value: "rent-desc", label: "Highest rent" },
          { value: "owed-desc", label: "Owes the most" },
        ]
      : []),
    { value: "newest", label: "Newest first" },
    { value: "since", label: "Customer since" },
  ];

  const savedViews =
    workspace?.prefs.savedViews
      .filter((v) => v.routeKey === "customers")
      .map((v) => ({ id: v.id, label: v.label, href: savedViewHref(v), builtIn: false })) ?? [];
  const views = [
    { id: "all", label: "All customers", href: "/desk/customers?segment=all", builtIn: true },
    ...builtInViewsFor("customers", {
      role,
      shownFeatures: ownerOrAdmin ? new Set(["propertyManagers"]) : new Set<string>(),
    }),
    ...savedViews,
  ];

  // The header export carries the current filters (not the cursor).
  const exportParams = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) {
    if (k === "cursor" || k === "open" || k === "page" || v === undefined) continue;
    if (Array.isArray(v)) for (const x of v) exportParams.append(k, x);
    else exportParams.set(k, v);
  }
  if (params.segment) exportParams.set("segment", params.segment);
  if (params.since) exportParams.set("since", params.since);
  const exportHref = `/desk/customers/export?${exportParams.toString()}`;

  const filtered = Boolean(
    params.q ||
      params.city?.length ||
      params.pm ||
      params.autopay ||
      params.service ||
      params.appliance?.length ||
      params.since ||
      segment === "all",
  );

  const columns: Column<CustomerListRow>[] = [
    {
      key: "customer",
      header: "Customer",
      cell: (row) => {
        const sub = sublineFor(row);
        return (
          <div>
            <span>{row.name}</span>
            {sub ? <span className="mt-0.5 block text-sm font-normal text-ink-soft">{sub}</span> : null}
          </div>
        );
      },
      sortValue: "name",
    },
    { key: "city", header: "City", cell: (row) => row.city ?? "" },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const pill = pillFor(row);
        return <StatusPill label={pill.label} tone={pill.tone} />;
      },
    },
    ...(ownerOrAdmin
      ? [
          {
            key: "rent",
            header: "Monthly rent",
            align: "right",
            cell: (row: CustomerListRow) => formatMoney(row.monthlyRentCents ?? 0),
            sortValue: "rent-desc",
          } as Column<CustomerListRow>,
          {
            key: "owes",
            header: "Owes",
            align: "right",
            cell: (row: CustomerListRow) =>
              (row.owedCents ?? 0) > 0 ? formatMoney(row.owedCents ?? 0) : "—",
            sortValue: "owed-desc",
          } as Column<CustomerListRow>,
          {
            key: "autopay",
            header: "Autopay",
            cell: (row: CustomerListRow) => (row.autopay ? "Autopay on" : "Autopay off"),
          } as Column<CustomerListRow>,
        ]
      : []),
    { key: "next", header: "Next", cell: (row) => nextEventText(row, now) },
  ];

  const openId = typeof raw.open === "string" ? raw.open : undefined;
  const openRow = openId ? list.rows.find((r) => r.id === openId) : undefined;
  const closeParams = new URLSearchParams(exportParams);
  closeParams.delete("segment");
  closeParams.set("segment", segment);
  const closeHref = `/desk/customers?${closeParams.toString()}`;

  return (
    <PullToRefresh>
      <div className="px-1 sm:px-0">
        <ScreenHeader
          title="Customers"
          list
          primary={
            ownerOrAdmin
              ? { kind: "link", label: "New customer", href: "/desk/customers/new" }
              : undefined
          }
          overflow={
            ownerOrAdmin
              ? [{ kind: "link", label: "Export (CSV)", href: exportHref }]
              : undefined
          }
        />
        <AutoRefresh />
        <Toaster />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <StatusTabs label="Customer group" param="segment" current={segment} items={tabs} />
          <div className="min-w-0 flex-1">
            <Toolbar
              search={{
                param: "q",
                placeholder: "Name, phone, email, address or appliance number",
                label: "Search customers",
              }}
              filters={filters}
              sorts={sorts}
              currentSort={params.sort ?? "attention"}
              views={views}
              saveViewAction={ownerOrAdmin ? saveCustomerViewAction : undefined}
              saveViewKeys={["segment", "city", "pm", "autopay", "service", "appliance", "sincePreset"]}
            />
          </div>
        </div>
        <div className="mt-2">
          <DataTable
            caption="Customers"
            rows={list.rows}
            rowKey={(row) => row.id}
            columns={columns}
            rowHref={(row) => `/desk/customers/${row.id}`}
            mobileCardLink
            rowActions={(row) => rowActions(row, role)}
            currentSort={params.sort ?? "attention"}
            selectedKey={openId}
            bulkActions={
              ownerOrAdmin
                ? [{ label: "Export selected (CSV)", action: exportSelectedCustomersAction }]
                : undefined
            }
            mobileCard={(row) => {
              const pill = pillFor(row);
              const sub = sublineFor(row);
              return (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-ink">{row.name}</span>
                    <StatusPill label={pill.label} tone={pill.tone} />
                  </div>
                  {sub ? <span className="text-sm text-ink-soft">{sub}</span> : null}
                  {row.city ? <span className="text-sm text-ink-soft">{row.city}</span> : null}
                  <span className="flex items-center justify-between text-sm text-ink-soft">
                    <span>{nextEventText(row, now)}</span>
                    {ownerOrAdmin ? (
                      <span className="font-semibold text-ink">
                        {formatMoney(row.monthlyRentCents ?? 0)}/mo
                        {(row.owedCents ?? 0) > 0 ? ` · owes ${formatMoney(row.owedCents ?? 0)}` : ""}
                      </span>
                    ) : null}
                  </span>
                </div>
              );
            }}
            empty={
              filtered ? (
                <EmptyState
                  title="No customers match"
                  action={{ kind: "link", label: "Clear filters", href: `/desk/customers?segment=${segment}` }}
                />
              ) : segment === "active" ? (
                <EmptyState title="No active customers yet" />
              ) : (
                <EmptyState title="No customers here" />
              )
            }
            nextHref={
              list.nextCursor
                ? customersHref({ ...params, sincePreset }, { cursor: list.nextCursor })
                : null
            }
            capReached={list.capped}
          />
        </div>
        {openRow ? (
          <SidePanel
            title={openRow.name}
            closeHref={closeHref}
            fullHref={`/desk/customers/${openRow.id}`}
          >
            <div className="flex flex-col gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {(() => {
                    const pill = pillFor(openRow);
                    return <StatusPill label={pill.label} tone={pill.tone} />;
                  })()}
                  {openRow.isPropertyManager ? (
                    <StatusPill label="Property manager" tone="neutral" />
                  ) : null}
                </div>
                {sublineFor(openRow) ? (
                  <p className="mt-2 text-sm text-ink-soft">{sublineFor(openRow)}</p>
                ) : null}
                <p className="mt-1 text-sm text-ink-soft">
                  {openRow.city ? `${openRow.city} · ` : ""}Customer since{" "}
                  {formatShortDate(openRow.createdAt, now)}
                </p>
              </div>
              <StatStrip
                items={[
                  { label: "Active rentals", value: String(openRow.activeCount) },
                  ...(ownerOrAdmin
                    ? [
                        { label: "Monthly rent", value: formatMoney(openRow.monthlyRentCents ?? 0) },
                        {
                          label: "Owes",
                          value:
                            (openRow.owedCents ?? 0) > 0
                              ? formatMoney(openRow.owedCents ?? 0)
                              : "Nothing",
                        },
                        { label: "Autopay", value: openRow.autopay ? "On" : "Off" },
                      ]
                    : []),
                  { label: "Properties", value: String(openRow.propertyCount) },
                ]}
              />
              <div>
                <p className="text-xs font-bold text-ink-soft">Next step</p>
                <p className="mt-1 text-[15px] font-bold text-ink">{nextEventText(openRow, now)}</p>
              </div>
            </div>
          </SidePanel>
        ) : null}
      </div>
    </PullToRefresh>
  );
}
