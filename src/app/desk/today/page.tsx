import Link from "next/link";
import { getExceptions, getTodaysJobs } from "@/domains/exceptions";
import type { ExceptionCategory } from "@/domains/exceptions";

export const metadata = { title: "Today" };

const CATEGORY_LABELS: Record<ExceptionCategory, string> = {
  BILLING_BLOCKED: "Billing blocked",
  STALE_RESERVATION: "Reservation expired",
  PAST_DUE_INVOICE: "Past due",
  OVERDUE_JOB: "Overdue job",
  UNREVIEWED_MAINTENANCE_REQUEST: "Needs review",
  UNINSPECTED_RETURN: "Needs inspection",
  MISSING_REPAIR_COST: "Repair cost missing",
  AGREEMENT_TERM_EXPIRED: "Term ended",
  APPLIANCE_MAINTENANCE_DUE: "Maintenance due",
};

const JOB_STATUS_LABELS: Record<string, string> = {
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};

function formatTime(date: Date | null): string {
  if (!date) return "No time set";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function daysAgo(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export default async function TodayPage() {
  const [exceptions, todaysJobs] = await Promise.all([getExceptions(), getTodaysJobs()]);

  const highSeverity = exceptions.filter((e) => e.severity === "high");
  const mediumSeverity = exceptions.filter((e) => e.severity === "medium");

  return (
    <div>
      <h1 className="text-xl font-semibold">Today</h1>
      <p className="mt-1 max-w-2xl text-sm text-gray-600">
        What&apos;s on the schedule today, and anything stuck that needs
        your attention — so nothing sits forgotten on a page you didn&apos;t
        happen to open.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="font-medium text-gray-900">
            Needs your attention
            {exceptions.length > 0 && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">
                {exceptions.length}
              </span>
            )}
          </h2>

          {exceptions.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600">
              Nothing needs your attention right now.
            </p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...highSeverity, ...mediumSeverity].map((item, i) => (
                <li
                  key={`${item.category}-${i}`}
                  className={`rounded-lg border p-4 ${
                    item.severity === "high"
                      ? "border-red-300 bg-red-50"
                      : "border-amber-300 bg-amber-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${
                          item.severity === "high"
                            ? "bg-red-200 text-red-900"
                            : "bg-amber-200 text-amber-900"
                        }`}
                      >
                        {CATEGORY_LABELS[item.category]}
                      </span>
                      <p className="mt-1 font-medium text-gray-900">{item.title}</p>
                      <p className="mt-0.5 text-sm text-gray-700">{item.detail}</p>
                      <p className="mt-1 text-xs text-gray-500">Since {daysAgo(item.since)}</p>
                    </div>
                    <Link
                      href={item.href}
                      className="shrink-0 whitespace-nowrap rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
                    >
                      Fix this
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 className="font-medium text-gray-900">
            Today&apos;s schedule
            {todaysJobs.length > 0 && (
              <span className="ml-2 rounded-full bg-gray-200 px-2 py-0.5 text-xs font-semibold text-gray-700">
                {todaysJobs.length}
              </span>
            )}
          </h2>

          {todaysJobs.length === 0 ? (
            <p className="mt-3 text-sm text-gray-600">Nothing scheduled for today.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {todaysJobs.map((job) => (
                <li key={job.id} className="rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-gray-900">
                        {formatTime(job.scheduledAt)} — {job.type.replace(/_/g, " ").toLowerCase()}
                      </p>
                      {job.customer && (
                        <p className="text-sm text-gray-700">
                          {job.customer.user.name ?? job.customer.user.email}
                        </p>
                      )}
                      {job.serviceAddress && (
                        <p className="text-sm text-gray-600">
                          {job.serviceAddress.line1}, {job.serviceAddress.city}
                        </p>
                      )}
                      <p className="mt-1 text-xs text-gray-500">
                        {JOB_STATUS_LABELS[job.status] ?? job.status}
                      </p>
                    </div>
                    <Link
                      href={`/desk/jobs/${job.id}`}
                      className="shrink-0 whitespace-nowrap rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Open
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
