import { requireRole } from "@/lib/session";
import Link from "next/link";
import { getAppliancesPage, getAppliancesCount, getApplianceCountsByStatus } from "@/domains/inventory";
import { getAllApplianceTypes } from "@/domains/settings";
import { NewApplianceForm } from "./new-appliance-form";
import { InventoryList } from "./inventory-list";
import type { ApplianceStatus } from "@prisma/client";
import { ALL_APPLIANCE_STATUSES, APPLIANCE_STATUS_LABELS } from "@/domains/inventory/lifecycle";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ExportCsvLink } from "@/components/export-csv-link";
import { ApplianceServiceIcon } from "@/components/icons/service-icons";

export const metadata = { title: "Inventory" };

const STATUS_TABS: { value: ApplianceStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  ...ALL_APPLIANCE_STATUSES.map((value) => ({ value, label: APPLIANCE_STATUS_LABELS[value] })),
];

function isApplianceStatus(value: string | undefined): value is ApplianceStatus {
  return ALL_APPLIANCE_STATUSES.includes(value as ApplianceStatus);
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canManage = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = isApplianceStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

  const [totalCount, counts, applianceTypes] = await Promise.all([
    getAppliancesCount(filter),
    getApplianceCountsByStatus(),
    getAllApplianceTypes(),
  ]);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const appliances = await getAppliancesPage(filter, meta.skip, meta.pageSize);

  const activeTypes = applianceTypes.filter((t) => t.isActive);

  function tabHref(value: ApplianceStatus | "ALL"): string {
    return value === "ALL" ? "/desk/inventory" : `/desk/inventory?status=${value}`;
  }

  function pageHref(p: number): string {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/desk/inventory?${qs}` : "/desk/inventory";
  }

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <ApplianceServiceIcon className="h-5 w-5 text-ink-faint" />
          Inventory
        </h1>
        {canManage && <ExportCsvLink
          href={status ? `/desk/inventory/export?status=${status}` : "/desk/inventory/export"}
        />}
      </div>
      <p className="mt-1 text-sm text-ink-soft">
        Every individual appliance unit you own — separate from the
        categories and pricing managed in Settings.
      </p>

      {canManage && <div className="mt-6">
        <NewApplianceForm
          applianceTypes={activeTypes.map((t) => ({ id: t.id, name: t.name }))}
        />
      </div>}

      <nav aria-label="Filter inventory by status" className="mt-8 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const count = tab.value === "ALL" ? undefined : counts[tab.value];
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={tabHref(tab.value)}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-primary bg-action text-on-action"
                  : "border-line-strong text-ink-soft hover:border-line-strong"
              }`}
            >
              {tab.label}
              {count !== undefined ? ` (${count})` : ""}
            </Link>
          );
        })}
      </nav>

      {appliances.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          {status
            ? "No appliances with this status."
            : "No appliances yet — add your first one above as you obtain it."}
        </p>
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

