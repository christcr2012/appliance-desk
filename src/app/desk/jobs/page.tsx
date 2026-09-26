import Link from "next/link";
import { getJobs } from "@/domains/jobs";
import type { JobStatus } from "@prisma/client";

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

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status: rawStatus } = await searchParams;
  const status = isJobStatus(rawStatus) ? rawStatus : undefined;

  const jobs = await getJobs(status ? { status } : undefined);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Jobs</h1>
        <Link
          href="/desk/jobs/new"
          className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
        >
          + Schedule a job
        </Link>
      </div>

      <nav aria-label="Filter jobs by status" className="mt-6 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => {
          const active = (status ?? "ALL") === tab.value;
          return (
            <Link
              key={tab.value}
              href={tab.value === "ALL" ? "/desk/jobs" : `/desk/jobs?status=${tab.value}`}
              aria-current={active ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm ${
                active
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-300 text-gray-700 hover:border-gray-400"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {jobs.length === 0 ? (
        <p className="mt-6 text-sm text-gray-600">
          {status ? "No jobs with this status." : "No jobs scheduled yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white">
          {jobs.map((j) => (
            <li key={j.id}>
              <Link
                href={`/desk/jobs/${j.id}`}
                className="flex flex-col gap-1 px-4 py-4 hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <p className="font-medium text-gray-900">
                    {j.type} {j.customer && `— ${j.customer.user.name ?? j.customer.user.email}`}
                  </p>
                  <p className="text-sm text-gray-600">
                    {j.serviceAddress
                      ? `${j.serviceAddress.line1}, ${j.serviceAddress.city}`
                      : "No address on file"}
                  </p>
                </div>
                <div className="text-sm text-gray-500 sm:text-right">
                  <p>{j.status}</p>
                  <p>
                    {j.scheduledAt
                      ? new Date(j.scheduledAt).toLocaleString()
                      : "Not scheduled yet"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
