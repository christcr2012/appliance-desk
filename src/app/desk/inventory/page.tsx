import { requireRole } from "@/lib/session";
import {
  getAppliancesPage,
  getAppliancesCount,
  getApplianceCountsByStatus,
} from "@/domains/inventory";
import { getAllApplianceTypes } from "@/domains/settings";
import { NewApplianceForm } from "./new-appliance-form";
import { InventoryList } from "./inventory-list";
import type { ApplianceStatus } from "@prisma/client";
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
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canManage =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = isApplianceStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

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
    return value === "ALL"
      ? "/desk/inventory"
      : `/desk/inventory?status=${value}`;
  }

  function pageHref(page: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
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

      {canManage && (
        <div className="mb-6">
          <Card
            title="Add appliances you've obtained"
            description="Add one unit or several identical units, then complete unit-specific details from each appliance record."
          >
            <NewApplianceForm
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
