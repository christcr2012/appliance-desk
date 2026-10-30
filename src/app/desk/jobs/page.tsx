import { redirect } from "next/navigation";
import type { JobStatus } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { getJobsPage, getJobsCount } from "@/domains/jobs";
import { parsePage, paginationMeta } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import {
  EmptyState,
  StatusPill,
} from "@/components/ui";
import { DataTable, ScreenHeader, StatusTabs, type Column } from "@/components/kit";
import {
  jobStatusLabel,
  jobStatusTone,
  jobKindLabel,
} from "@/lib/status-labels";

export const metadata = { title: "Jobs" };

const STATUS_TABS: { value: JobStatus | "ALL"; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "SCHEDULED", label: "Scheduled" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETED", label: "Completed" },
  { value: "CANCELLED", label: "Cancelled" },
];

function isJobStatus(value: string | undefined): value is JobStatus {
  return (
    value === "SCHEDULED" ||
    value === "IN_PROGRESS" ||
    value === "COMPLETED" ||
    value === "CANCELLED"
  );
}

type JobRow = Awaited<ReturnType<typeof getJobsPage>>[number];

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string; open?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canScheduleJobs =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, page: rawPage, open } = await searchParams;
  // The kit table's row click sets ?open=<id> (its side-panel convention).
  // Jobs have no side panel — the record page IS the destination, as it
  // was before the redesign — so an ?open= link goes straight there.
  if (open) redirect(`/desk/jobs/${encodeURIComponent(open)}`);
  const status = isJobStatus(rawStatus) ? rawStatus : undefined;
  const filter = status ? { status } : undefined;

  const totalCount = await getJobsCount(filter);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const jobs = await getJobsPage(filter, meta.skip, meta.pageSize);

  function jobsHref(
    page: number,
    forStatus: JobStatus | "ALL" = status ?? "ALL",
  ) {
    const params = new URLSearchParams();
    if (forStatus !== "ALL") params.set("status", forStatus);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/jobs?${qs}` : "/desk/jobs";
  }

  const columns: Column<JobRow>[] = [
    {
      key: "job",
      header: "Job",
      cell: (job) => (
        <div>
          <span className="font-semibold text-ink">
            {jobKindLabel(job)}
            {job.customer &&
              ` — ${job.customer.user.name ?? job.customer.user.email}`}
          </span>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {job.serviceAddress
              ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}`
              : "No address on file"}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (job) => (
        <StatusPill
          tone={jobStatusTone(job.status)}
          label={jobStatusLabel(job.status)}
        />
      ),
    },
    {
      key: "scheduled",
      header: "Scheduled",
      cell: (job) =>
        job.scheduledAt
          ? new Date(job.scheduledAt).toLocaleString()
          : "Not scheduled yet",
    },
  ];

  return (
    <div>
      <ScreenHeader
        title="Jobs"
        list
        primary={canScheduleJobs ? { kind: "link", label: "Schedule a job", href: "/desk/jobs/new" } : undefined}
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Review scheduled, active, completed, and cancelled service work.
      </p>

      <StatusTabs
        label="Filter jobs by status"
        param="status"
        current={status ?? "ALL"}
        items={STATUS_TABS.map((tab) => ({ value: tab.value, label: tab.label }))}
      />

      <DataTable
        rows={jobs}
        rowKey={(job) => job.id}
        columns={columns}
        caption="Jobs"
        rowHref={(job) => `/desk/jobs/${job.id}`}
        mobileCard={(job) => (
          <div className="space-y-1">
            {columns[0].cell(job)}
            {columns[1].cell(job)}
          </div>
        )}
        empty={
          <EmptyState
            title={status ? "No jobs with this status" : "No jobs scheduled yet"}
            description={
              status
                ? "Choose another status to review different jobs."
                : "Scheduled work will appear here."
            }
          />
        }
      />

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(page) => jobsHref(page)}
      />
    </div>
  );
}
