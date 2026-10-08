import { requireRole } from "@/lib/session";
import Link from "next/link";
import {
  getAppliancesPage,
  getAppliancesCount,
  getApplianceCountsByStatus,
} from "@/domains/inventory";
import { getAllApplianceTypes } from "@/domains/settings";
import { NewApplianceForm } from "./new-appliance-form";
import { InventoryList } from "./inventory-list";
import type { ApplianceStatus, AcquisitionTaxStatus } from "@prisma/client";
import {
  ALL_APPLIANCE_STATUSES,
  APPLIANCE_STATUS_LABELS,
} from "@/domains/inventory/lifecycle";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ExportCsvLink } from "@/components/export-csv-link";
import { FilterBar } from "@/components/desk/workspace";
import { Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Inventory" };

const TAX_STATES: { value: AcquisitionTaxStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All purchase-tax states" },
  { value: "UNKNOWN", label: "Needs tax review" },
  { value: "SALES_TAX_PAID", label: "Seller tax paid" },
  { value: "USE_TAX_DUE", label: "Use tax due" },
  { value: "USE_TAX_PAID", label: "Use tax paid" },
  { value: "BOUGHT_TAX_FREE_FOR_LEASE", label: "Lessor purchase permission" },
];

const STATUS_TABS: { value: ApplianceStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  ...ALL_APPLIANCE_STATUSES.map((value) => ({
    value,
    label: APPLIANCE_STATUS_LABELS[value],
  })),
];

function isApplianceStatus(
  value: string | undefined,
): value is ApplianceStatus {
  return ALL_APPLIANCE_STATUSES.includes(value as ApplianceStatus);
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; taxStatus?: string; page?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canManage =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, taxStatus: rawTaxStatus, page: rawPage } = await searchParams;
  const status = isApplianceStatus(rawStatus) ? rawStatus : undefined;
  const taxStatus = session.user.role !== "STAFF" && TAX_STATES.some((t) => t.value === rawTaxStatus && t.value !== "ALL")
    ? rawTaxStatus as AcquisitionTaxStatus : undefined;
  const filter = status || taxStatus ? { ...(status ? { status } : {}), ...(taxStatus ? { taxStatus } : {}) } : undefined;

  const [totalCount, counts, applianceTypes] = await Promise.all([
    getAppliancesCount(filter),
    getApplianceCountsByStatus(),
    getAllApplianceTypes(),
  ]);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const appliances = await getAppliancesPage(
    filter,
    meta.skip,
    meta.pageSize,
  );

  const activeTypes = applianceTypes.filter((type) => type.isActive);

  function tabHref(value: ApplianceStatus | "ALL"): string {
    const params = new URLSearchParams();
    if (value !== "ALL") params.set("status", value);
    if (taxStatus) params.set("taxStatus", taxStatus);
    return `/desk/inventory${params.size ? `?${params.toString()}` : ""}`;
  }

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (taxStatus) params.set("taxStatus", taxStatus);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/inventory?${qs}` : "/desk/inventory";
  }

  return (
    <div>
      <PageHeader
        title="Inventory"
        description="Every individual appliance unit you own — separate from the categories and pricing managed in Settings."
        secondaryActions={
          canManage ? (
            <ExportCsvLink
              href={
                status
                  ? `/desk/inventory/export?status=${status}`
                  : "/desk/inventory/export"
              }
            />
          ) : undefined
        }
      />

      {session.user.role === "OWNER" && (
        <nav aria-label="Inventory purchase tax" className="mb-4 flex flex-wrap gap-4 text-sm">
          <Link href="/desk/tax/use-tax-settings" className="underline">Use-tax threshold</Link>
          <Link href="/desk/tax/use-tax-worksheets" className="underline">Private filing worksheets</Link>
        </nav>
      )}

      {canManage && (
        <div className="mb-6">
          <Card
            title="Add appliances you've obtained"
            description="Add one unit or several identical units, then complete unit-specific details from each appliance record."
          >
            <NewApplianceForm
              canRecordTax={session.user.role === "OWNER"}
              applianceTypes={activeTypes.map((type) => ({
                id: type.id,
                name: type.name,
              }))}
            />
          </Card>
        </div>
      )}

      <FilterBar
        label="Filter inventory by status"
        items={STATUS_TABS.map((tab) => ({
          href: tabHref(tab.value),
          label:
            tab.value === "ALL"
              ? tab.label
              : `${tab.label} (${counts[tab.value]})`,
          active: (status ?? "ALL") === tab.value,
        }))}
      />

      {session.user.role !== "STAFF" && (
        <nav aria-label="Filter purchase-tax status" className="mb-4">
          <p className="mb-2 text-sm font-semibold">Purchase-tax status</p>
          <div className="flex flex-wrap gap-2">
            {TAX_STATES.map((item) => {
              const params = new URLSearchParams();
              if (status) params.set("status", status);
              if (item.value !== "ALL") params.set("taxStatus", item.value);
              return (
                <Link key={item.value}
                  href={`/desk/inventory${params.size ? `?${params.toString()}` : ""}`}
                  aria-current={(taxStatus ?? "ALL") === item.value ? "page" : undefined}
                  className={`rounded-md border px-3 py-1.5 text-sm ${(taxStatus ?? "ALL") === item.value ? "font-semibold underline" : ""}`}
                >{item.label}</Link>
              );
            })}
          </div>
        </nav>
      )}

      {appliances.length === 0 ? (
        <EmptyState
          title={
            status ? "No appliances with this status" : "No appliances yet"
          }
          description={
            status
              ? "Choose another status to review different inventory."
              : canManage
                ? "Add your first appliance above as you obtain it."
                : "Inventory will appear here once appliances are added."
          }
        />
      ) : (
        <InventoryList appliances={appliances} canManage={canManage} />
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={pageHref}
      />
    </div>
  );
}
