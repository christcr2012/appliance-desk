import Link from "next/link";
import {
  getExceptionOverview,
  getTodaysJobs,
  type ExceptionCategory,
} from "@/domains/exceptions";
import { getDueTaskSummary } from "@/domains/tasks/workspace";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  businessDateKey,
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import {
  PageHeader,
  SectionCard,
  EmptyState,
  Metric,
  primaryActionClass,
  secondaryActionClass,
} from "@/components/desk/workspace";
import { TaskRow } from "../tasks/task-row";

export const metadata = { title: "Today" };
const CATEGORIES: Record<ExceptionCategory, { label: string; action: string }> =
  {
    BILLING_BLOCKED: { label: "Billing blocked", action: "Review rental" },
    STALE_RESERVATION: {
      label: "Reservation expired",
      action: "Review reservation",
    },
    PAST_DUE_INVOICE: { label: "Past due", action: "Review billing" },
    OVERDUE_JOB: { label: "Overdue job", action: "Review job" },
    UNREVIEWED_MAINTENANCE_REQUEST: {
      label: "Needs review",
      action: "Review request",
    },
    UNINSPECTED_RETURN: { label: "Needs inspection", action: "Inspect return" },
    MISSING_REPAIR_COST: {
      label: "Repair cost missing",
      action: "Review repair",
    },
    AGREEMENT_TERM_EXPIRED: { label: "Term ended", action: "Review rental" },
    APPLIANCE_MAINTENANCE_DUE: {
      label: "Maintenance due",
      action: "Review appliance",
    },
    RENEWAL_NOT_STARTED: { label: "Renewal did not start", action: "Review renewal" },
    NOTICE_WAITING: { label: "Renewal reminder waiting", action: "Send reminder" },
    NOTICE_MISSED: { label: "Renewal reminder missed", action: "Fix it" },
    NOTICE_UNCERTAIN: { label: "Reminder may have gone out", action: "Check it" },
    NOTICE_FAILED: { label: "Reminder refused", action: "Fix it" },
    EARLY_ENDING_NOT_DONE: { label: "Early ending not carried out", action: "Review ending" },
    ITEM_NOT_DELIVERED: { label: "Item not delivered yet", action: "Review delivery" },
    RETURNED_EARLY: { label: "Returned early", action: "Choose what to do" },
    SUBSCRIPTION_UPDATE_PENDING: { label: "Monthly bill not lowered yet", action: "Review item" },
    CUSTODY_UNKNOWN: { label: "Who has this appliance?", action: "Record customer" },
  };

export default async function TodayPage() {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canCreate = ["OWNER", "ADMIN"].includes(
    (session.user as { role?: string }).role ?? "",
  );
  const now = new Date();
  const [{ items: exceptions, truncated }, jobs, followUps, openRequests] = await Promise.all([
    getExceptionOverview(),
    getTodaysJobs(now),
    getDueTaskSummary(now),
    prisma.maintenanceRequest.count({
      where: {
        status: { in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"] },
      },
    }),
  ]);
  const active = jobs.filter(
    (j) => j.status === "SCHEDULED" || j.status === "IN_PROGRESS",
  );
  const completed = jobs.filter((j) => j.status === "COMPLETED");
  const next = active.find((j) => j.status === "IN_PROGRESS") ?? active[0];
  const today = businessDateKey(now);
  return (
    <div>
      <PageHeader
        title="Today"
        description={`${formatBusinessDate(now)} · Colorado time`}
        primaryAction={
          canCreate ? (
            <Link href="/desk/agreements/new" className={primaryActionClass}>
              Create rental
            </Link>
          ) : undefined
        }
        secondaryActions={
          <Link href="/desk/tasks#new-task" className={secondaryActionClass}>
            Add task
          </Link>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Metric
          label="Jobs remaining today"
          value={active.length}
          href="/desk/dispatch"
          basis="Scheduled or in progress"
        />
        <Metric
          label="Overdue follow-ups"
          value={followUps.overdueCount}
          href="/desk/tasks?due=overdue"
          basis="Open tasks due before today"
        />
        <Metric
          label="Open service requests"
          value={openRequests}
          href="/desk/maintenance"
          basis="Requests still awaiting resolution"
        />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-3">
        <div className="min-w-0 space-y-6 xl:col-span-2">
          <SectionCard
            title="Needs your attention"
            description={
              exceptions.length
                ? `${exceptions.length} items, most urgent first${truncated.length ? " (the longest-waiting ones in each group)" : ""}`
                : undefined
            }
          >
            {exceptions.length === 0 ? (
              <EmptyState
                title="Nothing urgent right now"
                description="Check upcoming jobs or follow up with a lead."
                action={
                  <Link href="/desk/leads" className={secondaryActionClass}>
                    View leads
                  </Link>
                }
              />
            ) : (
              <ul className="space-y-3">
                {exceptions.map((item) => (
                  <li
                    key={`${item.category}-${item.href}`}
                    className="rounded-lg border border-line p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 break-words">
                        <p className="text-xs font-semibold text-ink-soft">
                          {item.severity === "high" ? "High priority · " : ""}
                          {CATEGORIES[item.category].label}
                        </p>
                        <h3 className="mt-1 font-semibold text-ink">
                          {item.title}
                        </h3>
                        <p className="mt-1 text-sm text-ink-soft">
                          {item.detail}
                        </p>
                        <p className="mt-2 text-xs text-ink-soft">
                          Flagged since {formatBusinessDate(item.since)}
                        </p>
                      </div>
                      <Link href={item.href} className={secondaryActionClass}>
                        {CATEGORIES[item.category].action}
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {truncated.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-ink-soft">
                {truncated.map((t) => (
                  <li key={t.category}>
                    {CATEGORIES[t.category].label}: showing the {t.shown} that have waited longest, {t.total - t.shown} more not shown.
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
        <div className="min-w-0 space-y-6">
          {next && (
            <SectionCard
              title={
                next.status === "IN_PROGRESS"
                  ? "Visit in progress"
                  : "Next visit"
              }
            >
              <p className="font-semibold text-ink">
                {next.customer?.user.name ??
                  next.customer?.user.email ??
                  "Internal job"}
              </p>
              <p className="mt-1 text-sm text-ink-soft">
                {next.scheduledAt && formatBusinessTime(next.scheduledAt)} ·{" "}
                {next.type.replaceAll("_", " ").toLowerCase()}
              </p>
              {next.serviceAddress && (
                <p className="mt-1 break-words text-sm text-ink-soft">
                  {next.serviceAddress.line1}, {next.serviceAddress.city}
                </p>
              )}
              <Link
                href={`/desk/jobs/${next.id}`}
                className={`${primaryActionClass} mt-4`}
              >
                Open next job
              </Link>
            </SectionCard>
          )}
          <SectionCard
            title="Follow-ups due"
            description={`Due today or earlier · showing ${followUps.tasks.length} of ${followUps.totalCount}`}
            actions={
              <Link
                href="/desk/tasks"
                className="text-sm font-medium text-ink underline"
              >
                All tasks
              </Link>
            }
          >
            {followUps.tasks.length ? (
              <ul className="divide-y divide-line">
                {followUps.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} today={today} />
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No follow-ups due"
                description="Open tasks without a due date remain on the Tasks page."
              />
            )}
          </SectionCard>
          <SectionCard
            title="Today's schedule"
            actions={
              <Link
                href="/desk/dispatch"
                className="text-sm font-medium text-ink underline"
              >
                Dispatch
              </Link>
            }
          >
            {active.length ? (
              <ul className="space-y-3">
                {active.map((job) => (
                  <li
                    key={job.id}
                    className="border-b border-line pb-3 last:border-0"
                  >
                    <Link
                      href={`/desk/jobs/${job.id}`}
                      className="block min-h-11 rounded-lg text-sm text-ink hover:underline"
                    >
                      <span className="block font-semibold">
                        {job.scheduledAt && formatBusinessTime(job.scheduledAt)}{" "}
                        · {job.type.replaceAll("_", " ").toLowerCase()}
                      </span>
                      <span className="mt-1 block break-words">
                        {job.customer?.user.name ??
                          job.customer?.user.email ??
                          "Internal job"}
                      </span>
                      <span className="mt-1 block text-ink-soft">
                        {job.status === "IN_PROGRESS"
                          ? "In progress"
                          : "Scheduled"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                title="No remaining visits today"
                action={
                  <Link href="/desk/jobs" className={secondaryActionClass}>
                    View jobs
                  </Link>
                }
              />
            )}
            {completed.length > 0 && (
              <details className="mt-4 text-sm text-ink">
                <summary className="min-h-11 cursor-pointer py-3">
                  Completed today ({completed.length})
                </summary>
                <ul className="space-y-2">
                  {completed.map((job) => (
                    <li key={job.id}>
                      <Link
                        className="block min-h-11 py-3 underline"
                        href={`/desk/jobs/${job.id}`}
                      >
                        {job.customer?.user.name ?? "Internal job"} ·{" "}
                        {job.type.replaceAll("_", " ").toLowerCase()}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
