import Link from "next/link";
import type { MaintenanceStatus } from "@prisma/client";
import { getMaintenanceRequestsPage, getMaintenanceRequestsCount } from "@/domains/maintenance";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { FilterBar } from "@/components/desk/workspace";
import {
  DataList,
  EmptyState,
  PageHeader,
  StatusPill,
  type DataListColumn,
} from "@/components/ui";
import type { StatusTone } from "@/components/status-badge";
import { maintenanceStatusLabel } from "@/lib/status-labels";

export const metadata = { title: "Maintenance" };

const STATUS_TABS: { value: MaintenanceStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SUBMITTED", label: "Submitted" },
  { value: "REVIEWING", label: "Reviewing" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const STATUS_TONE: Record<MaintenanceStatus, StatusTone> = {
  SUBMITTED: "pending",
  REVIEWING: "progress",
  SCHEDULED: "progress",
  IN_PROGRESS: "progress",
  RESOLVED: "success",
  CLOSED: "stopped",
};

function isMaintenanceStatus(
  value: string | undefined,
): value is MaintenanceStatus {
  return (
    value === "SUBMITTED" ||
    value === "REVIEWING" ||
    value === "SCHEDULED" ||
    value === "IN_PROGRESS" ||
    value === "RESOLVED" ||
    value === "CLOSED"
  );
}

type MaintenanceRow = Awaited<
  ReturnType<typeof getMaintenanceRequestsPage>
>[number];

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { status: rawStatus, page: rawPage } = await searchParams;
  const status = isMaintenanceStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

  const totalCount = await getMaintenanceRequestsCount(filter);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const requests = await getMaintenanceRequestsPage(
    filter,
    meta.skip,
    meta.pageSize,
  );

  function maintenanceHref(
    page: number,
    forStatus: MaintenanceStatus | "ALL" = status ?? "ALL",
  ) {
    const params = new URLSearchParams();
    if (forStatus !== "ALL") params.set("status", forStatus);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/maintenance?${qs}` : "/desk/maintenance";
  }

  const columns: DataListColumn<MaintenanceRow>[] = [
    {
      key: "request",
      header: "Request",
      primary: true,
      cell: (request) => (
        <div>
          <Link
            href={`/desk/maintenance/${request.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {request.customer.user.name ?? request.customer.user.email}
          </Link>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {request.appliance
              ? `${request.appliance.applianceType.name} (${request.appliance.assetNumber})`
              : "General"}{" "}
            · {request.problem.slice(0, 80)}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (request) => (
        <StatusPill
          tone={STATUS_TONE[request.status]}
          label={maintenanceStatusLabel(request.status)}
        />
      ),
    },
    {
      key: "priority",
      header: "Priority",
      cell: (request) => request.priority,
    },
    {
      key: "opened",
      header: "Opened",
      cell: (request) => new Date(request.openedAt).toLocaleDateString(),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Maintenance requests"
        description="Customer-submitted service requests from the account portal."
      />

      <FilterBar
        label="Filter by status"
        items={STATUS_TABS.map((tab) => ({
          href: maintenanceHref(1, tab.value),
          label: tab.label,
          active: (status ?? "ALL") === tab.value,
        }))}
      />

      <DataList
        rows={requests}
        columns={columns}
        caption="Maintenance requests"
        empty={
          <EmptyState
            title={
              status
                ? "No requests with this status"
                : "No maintenance requests yet"
            }
            description={
              status
                ? "Choose another status to review different requests."
                : "Customer service requests will appear here."
            }
          />
        }
      />

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(page) => maintenanceHref(page)}
      />
    </div>
  );
}
