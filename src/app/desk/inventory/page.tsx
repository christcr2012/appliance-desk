import { requireRole } from "@/lib/session";
import Link from "next/link";
import {
  getFleet,
  getFleetCounts,
  getFleetTypeOptions,
  FLEET_TAB_STATUSES,
} from "@/domains/inventory";
import { FleetList } from "./fleet-list";
import { FLEET_TABS, parseFleetParams, type FleetParams } from "./params";
import { EmptyState, ScreenHeader, StatusTabs, Toolbar, type FilterDef } from "@/components/kit";
import { Toaster } from "@/components/kit/toaster";
import { builtInViewsFor } from "@/components/kit/built-in-views";

export const metadata = { title: "Equipment" };

const TAX_OPTIONS = [
  { value: "UNKNOWN", label: "Needs tax review" },
  { value: "SALES_TAX_PAID", label: "Seller tax paid" },
  { value: "USE_TAX_DUE", label: "Use tax due" },
  { value: "USE_TAX_PAID", label: "Use tax paid" },
  { value: "BOUGHT_TAX_FREE_FOR_LEASE", label: "Lessor purchase permission" },
];

const SORTS = [
  { value: "newest", label: "Newest" },
  { value: "number", label: "Appliance number" },
  { value: "type", label: "Type" },
];

function fleetHref(params: FleetParams, extra?: { cursor?: string }): string {
  const search = new URLSearchParams();
  if (params.tab !== "all") search.set("status", params.tab);
  if (params.type) search.set("type", params.type);
  if (params.tax) search.set("tax", params.tax);
  if (params.q) search.set("q", params.q);
  if (params.sort !== "newest") search.set("sort", params.sort);
  if (extra?.cursor) search.set("cursor", extra.cursor);
  const qs = search.toString();
  return qs ? `/desk/inventory?${qs}` : "/desk/inventory";
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = session.user.role;
  const canManage = role === "OWNER" || role === "ADMIN";
  const fleetRole = role === "OWNER" || role === "ADMIN" ? role : "STAFF";
  const params = parseFleetParams(await searchParams, fleetRole);

  const [list, counts, types] = await Promise.all([
    getFleet(params),
    getFleetCounts(params),
    getFleetTypeOptions(),
  ]);

  const filtered = Boolean(params.q || params.type || params.tax);
  const tabItems = FLEET_TABS.map((tab) => ({
    value: tab.value,
    label: tab.label,
    count: counts[tab.value],
    hideWhenZero: tab.value === "coming-back" || tab.value === "needs-work",
  }));

  const filters: FilterDef[] = [
    {
      kind: "select",
      param: "type",
      label: "Type",
      options: types.map((t) => ({ value: t.slug, label: t.name })),
    },
    ...(canManage
      ? [
          {
            kind: "select",
            param: "tax",
            label: "Purchase tax",
            options: TAX_OPTIONS,
          } as FilterDef,
        ]
      : []),
  ];

  const views = builtInViewsFor("inventory", {
    role: role === "OWNER" || role === "ADMIN" || role === "STAFF" ? role : undefined,
  });

  // The CSV export keeps its single-status contract: pass it when the tab
  // is exactly one status, otherwise export the whole fleet.
  const tabStatuses = FLEET_TAB_STATUSES[params.tab];
  const exportHref =
    tabStatuses.length === 1
      ? `/desk/inventory/export?status=${tabStatuses[0]}`
      : "/desk/inventory/export";

  return (
    <div>
      <Toaster />
      <ScreenHeader
        title="Equipment"
        list
        primary={
          canManage
            ? { kind: "link", label: "Record a purchase", href: "/desk/purchases/new" }
            : undefined
        }
        overflow={
          canManage
            ? [{ kind: "link", label: "Export CSV", href: exportHref }]
            : undefined
        }
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Every individual appliance unit you own — separate from the categories and pricing
        managed in Settings.
      </p>

      {role === "OWNER" && (
        <nav aria-label="Inventory purchase tax" className="mb-4 flex flex-wrap gap-4 text-sm">
          <Link href="/desk/sales-tax/use-tax/settings" className="underline">Use-tax threshold</Link>
          <Link href="/desk/sales-tax/use-tax" className="underline">Private filing worksheets</Link>
        </nav>
      )}

      <div className="mb-4">
        <StatusTabs
          label="Filter fleet by status"
          param="status"
          current={params.tab}
          items={tabItems}
        />
      </div>

      <Toolbar
        search={{
          param: "q",
          placeholder: "Appliance number, serial or model",
          label: "Search the fleet",
        }}
        filters={filters}
        sorts={SORTS}
        currentSort={params.sort}
        views={views}
      />

      {list.rows.length === 0 ? (
        filtered || params.tab !== "all" ? (
          <EmptyState title="No appliances here" />
        ) : (
          <EmptyState
            title="No appliances yet"
            action={
              canManage
                ? { kind: "link", label: "Record a purchase", href: "/desk/purchases/new" }
                : undefined
            }
          />
        )
      ) : (
        <FleetList
          rows={list.rows}
          canManage={canManage}
          nextHref={list.nextCursor ? fleetHref(params, { cursor: list.nextCursor }) : null}
        />
      )}
    </div>
  );
}
