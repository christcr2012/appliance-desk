import { requireRole } from "@/lib/session";
import Link from "next/link";
import {
  getAppliancesPage,
  getAppliancesCount,
  getApplianceCountsByStatus,
} from "@/domains/inventory";
import { InventoryList } from "./inventory-list";
import type { ApplianceStatus, AcquisitionTaxStatus } from "@prisma/client";
import {
  ALL_APPLIANCE_STATUSES,
  APPLIANCE_STATUS_LABELS,
} from "@/domains/inventory/lifecycle";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { ScreenHeader, StatusTabs } from "@/components/kit";

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

  const [totalCount, counts] = await Promise.all([
    getAppliancesCount(filter),
    getApplianceCountsByStatus(),
  ]);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const appliances = await getAppliancesPage(
    filter,
    meta.skip,
    meta.pageSize,
  );

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
      <ScreenHeader
        title="Inventory"
        list
        overflow={canManage ? [{ kind: "link", label: "Export CSV", href: status ? `/desk/inventory/export?status=${status}` : "/desk/inventory/export" }] : undefined}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Every individual appliance unit you own — separate from the categories and pricing managed in Settings.
      </p>

      {session.user.role === "OWNER" && (
        <nav aria-label="Inventory purchase tax" className="mb-4 flex flex-wrap gap-4 text-sm">
          <Link href="/desk/sales-tax/use-tax/settings" className="underline">Use-tax threshold</Link>
          <Link href="/desk/sales-tax/use-tax" className="underline">Private filing worksheets</Link>
        </nav>
      )}

      {canManage && (
        <div className="mb-6">
          <Card
            title="Bought appliances? Record the purchase"
            description="Enter the receipt once: the seller, the date, the tax and every appliance on it. Each appliance gets its own record."
          >
            <ButtonLink href="/desk/purchases/new">Record a purchase</ButtonLink>
          </Card>
        </div>
      )}

      <StatusTabs
        label="Filter inventory by status"
        param="status"
        current={status ?? "ALL"}
        items={STATUS_TABS.map((tab) => ({
          value: tab.value,
          label: tab.label,
          count: tab.value === "ALL" ? undefined : counts[tab.value],
        }))}
      />

      {session.user.role !== "STAFF" && (
        <StatusTabs
          label="Filter purchase-tax status"
          param="taxStatus"
          current={taxStatus ?? "ALL"}
          items={TAX_STATES.map((item) => ({ value: item.value, label: item.label }))}
        />
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
                ? "Record your first purchase above as you buy appliances."
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
