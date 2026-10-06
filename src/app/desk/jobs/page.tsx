import Link from "next/link";
import type { JobStatus } from "@prisma/client";
import { requireRole } from "@/lib/session";
import { getJobsPage, getJobsCount } from "@/domains/jobs";
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
import {
  jobStatusLabel,
  jobStatusTone,
  jobTypeLabel,
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
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canScheduleJobs =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { status: rawStatus, page: rawPage } = await searchParams;
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

  const columns: DataListColumn<JobRow>[] = [
    {
      key: "job",
      header: "Job",
      primary: true,
      cell: (job) => (
        <div>
          <Link
            href={`/desk/jobs/${job.id}`}
            className="font-semibold text-ink underline-offset-4 hover:underline"
          >
            {jobTypeLabel(job.type)}
            {job.customer &&
              ` — ${job.customer.user.name ?? job.customer.user.email}`}
          </Link>
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
      <PageHeader
        title="Jobs"
        description="Review scheduled, active, completed, and cancelled service work."
        primaryAction={
          canScheduleJobs
            ? { href: "/desk/jobs/new", label: "Schedule a job" }
            : undefined
        }
      />

      <FilterBar
        label="Filter jobs by status"
        items={STATUS_TABS.map((tab) => ({
          href: jobsHref(1, tab.value),
          label: tab.label,
          active: (status ?? "ALL") === tab.value,
        }))}
      />

      <DataList
        rows={jobs}
        columns={columns}
        caption="Jobs"
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
