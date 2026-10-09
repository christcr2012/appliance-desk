import {
  getExceptionOverview,
  getTodaysJobs,
  type ExceptionCategory,
} from "@/domains/exceptions";
import {
  manuallyApplyObservedRate,
  undoAutoAppliedRateVersion,
} from "@/domains/tax/official-rate-auto-apply";
import { acknowledgeOfficialSourceChange } from "@/domains/tax/official-source-watch";
import { getDueTaskSummary } from "@/domains/tasks/workspace";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  businessDateKey,
  formatBusinessDate,
  formatBusinessTime,
} from "@/lib/business-date";
import { jobTypeLabel } from "@/lib/status-labels";
import { revalidatePath } from "next/cache";
import {
  AttentionList,
  ButtonLink,
  Card,
  EmptyState,
  PageHeader,
  StatCard,
  VisitRow,
} from "@/components/ui";
import { TaskRow } from "../tasks/task-row";

export const metadata = { title: "Today" };

async function acknowledgeTaxSourceAction(formData: FormData) {
  "use server";
  const watchId = formData.get("watchId");
  const watchVersion = formData.get("watchVersion");
  if (
    typeof watchId !== "string" ||
    !watchId ||
    watchId.length > 200 ||
    typeof watchVersion !== "string" ||
    !/^[a-f0-9]{64}:\d{1,16}$/.test(watchVersion)
  ) {
    return;
  }
  await acknowledgeOfficialSourceChange(watchId, watchVersion);
  revalidatePath("/desk/today");
}

async function undoOfficialRateAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const rateVersionId = formData.get("rateVersionId");
  if (typeof rateVersionId !== "string" || !rateVersionId || rateVersionId.length > 200) {
    return;
  }
  await undoAutoAppliedRateVersion({
    rateVersionId,
    actorUserId: session.user.id,
  });
  revalidatePath("/desk/today");
}

async function applyOfficialRateAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER");
  const observationId = formData.get("observationId");
  if (typeof observationId !== "string" || !observationId || observationId.length > 200) {
    return;
  }
  await manuallyApplyObservedRate({
    observationId,
    actorUserId: session.user.id,
  });
  revalidatePath("/desk/today");
}

const CATEGORIES: Record<ExceptionCategory, string> = {
  SYSTEM_ISSUE: "System",
  BILLING_BLOCKED: "Billing blocked",
  SALES_TAX: "Sales tax",
  TAX_RETURN_DUE: "Tax returns to file",
  TAX_LICENSE_RENEWAL: "Tax licenses to renew",
  TAX_AMENDMENT_DUE: "Tax amendments requiring review",
  TAX_FILING_NOT_READY: "Tax returns not ready to file",
  ACQUISITION_TAX_REVIEW: "Appliance purchase tax needs review",
  PURCHASE_USE_TAX_DUE: "Consumer use tax to file",
  RETAIL_DELIVERY_FEE: "Retail delivery fee needs review",
  STALE_RESERVATION: "Reservation expired",
  PAST_DUE_INVOICE: "Past due",
  OVERDUE_JOB: "Overdue job",
  UNREVIEWED_MAINTENANCE_REQUEST: "Needs review",
  UNINSPECTED_RETURN: "Needs inspection",
  OLD_SET_APPLIANCE: "Old set record to split",
  MISSING_REPAIR_COST: "Repair cost missing",
  AGREEMENT_TERM_EXPIRED: "Term ended",
  APPLIANCE_MAINTENANCE_DUE: "Maintenance due",
  RENEWAL_NOT_STARTED: "Renewal did not start",
  NOTICE_WAITING: "Renewal reminder waiting",
  NOTICE_MISSED: "Renewal reminder missed",
  NOTICE_UNCERTAIN: "Reminder may have gone out",
  NOTICE_FAILED: "Reminder refused",
  EARLY_ENDING_NOT_DONE: "Early ending not carried out",
  ITEM_NOT_DELIVERED: "Item not delivered yet",
  RETURNED_EARLY: "Returned early",
  SUBSCRIPTION_UPDATE_PENDING: "Monthly bill not lowered yet",
  CUSTODY_UNKNOWN: "Who has this appliance?",
};

export default async function TodayPage() {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = (session.user as { role?: string }).role ?? "";
  const canCreateVisit = role === "OWNER" || role === "ADMIN";
  const now = new Date();

  const [{ items: exceptions, truncated }, jobs, followUps, openRequests] =
    await Promise.all([
      getExceptionOverview(),
      getTodaysJobs(now),
      getDueTaskSummary(now),
      prisma.maintenanceRequest.count({
        where: {
          status: {
            in: ["SUBMITTED", "REVIEWING", "SCHEDULED", "IN_PROGRESS"],
          },
        },
      }),
    ]);

  const visits = jobs.filter((job) => job.status !== "CANCELLED");
  const active = visits.filter(
    (job) => job.status === "SCHEDULED" || job.status === "IN_PROGRESS",
  );
  const next = active.find((job) => job.status === "IN_PROGRESS") ?? active[0];
  const today = businessDateKey(now);

  const typeCounts = new Map<string, number>();
  for (const job of visits) {
    typeCounts.set(job.type, (typeCounts.get(job.type) ?? 0) + 1);
  }
  const visitBreakdown = Array.from(typeCounts.entries())
    .map(([type, count]) => `${jobTypeLabel(type)}: ${count}`)
    .join(" · ");

  const grouped = new Map<
    ExceptionCategory,
    (typeof exceptions)[number][]
  >();
  for (const item of exceptions) {
    const items = grouped.get(item.category) ?? [];
    items.push(item);
    grouped.set(item.category, items);
  }
  const trueTotals = new Map(
    truncated.map((item) => [item.category, item.total]),
  );
  const attentionGroups = Array.from(grouped.entries()).map(
    ([category, items]) => ({
      category,
      title: CATEGORIES[category],
      total: trueTotals.get(category) ?? items.length,
      items,
    }),
  );
  const attentionTotal =
    exceptions.length +
    truncated.reduce(
      (total, item) => total + Math.max(0, item.total - item.shown),
      0,
    );

  const primaryAction = canCreateVisit
    ? { href: "/desk/jobs/new", label: "New visit" }
    : next
      ? { href: `/desk/jobs/${next.id}`, label: "My next visit" }
      : undefined;

  return (
    <div>
      <PageHeader
        title="Today"
        description={`${formatBusinessDate(now)} · Colorado time`}
        primaryAction={primaryAction}
        secondaryActions={
          <ButtonLink href="/desk/tasks#new-task" variant="secondary">
            Add task
          </ButtonLink>
        }
      />

      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Visits today"
          value={String(visits.length)}
          detail={visitBreakdown || "No visits scheduled"}
          href="/desk/dispatch"
          tone="headline"
        />
        <StatCard
          label="Items needing attention"
          value={String(attentionTotal)}
          href="/desk/today"
        />
        <StatCard
          label="Overdue follow-ups"
          value={String(followUps.overdueCount)}
          detail="Open tasks due before today"
          href="/desk/tasks?due=overdue"
        />
        <StatCard
          label="Open service requests"
          value={String(openRequests)}
          detail="Requests still awaiting resolution"
          href="/desk/maintenance"
        />
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card
          title="Today's visits"
          description={
            visits.length
              ? `${visits.length} scheduled for ${formatBusinessDate(now)}`
              : undefined
          }
        >
          {visits.length ? (
            <ul>
              {visits.map((job) => (
                <VisitRow
                  key={job.id}
                  time={
                    job.scheduledAt
                      ? formatBusinessTime(job.scheduledAt)
                      : "Time not set"
                  }
                  customer={
                    job.customer?.user.name ??
                    job.customer?.user.email ??
                    "Internal job"
                  }
                  address={
                    job.serviceAddress
                      ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}`
                      : "Address not set"
                  }
                  type={job.type}
                  status={job.status}
                  href={`/desk/jobs/${job.id}`}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No visits today"
              description="Scheduled visits will appear here."
              action={
                canCreateVisit ? (
                  <ButtonLink href="/desk/jobs/new" variant="secondary">
                    New visit
                  </ButtonLink>
                ) : (
                  <ButtonLink href="/desk/jobs" variant="secondary">
                    View jobs
                  </ButtonLink>
                )
              }
            />
          )}
        </Card>

        <Card
          title="Needs your attention"
          description={
            attentionTotal
              ? `${attentionTotal} items, grouped by what needs action`
              : undefined
          }
        >
          <AttentionList
            groups={attentionGroups}
            acknowledgeTaxSourceAction={
              role === "OWNER" ? acknowledgeTaxSourceAction : undefined
            }
            undoOfficialRateAction={
              role === "OWNER" ? undoOfficialRateAction : undefined
            }
            applyOfficialRateAction={
              role === "OWNER" ? applyOfficialRateAction : undefined
            }
          />
        </Card>
      </div>

      <div className="mt-6">
        <Card
          title="Follow-ups due"
          description={`Due today or earlier · showing ${followUps.tasks.length} of ${followUps.totalCount}`}
          actions={
            <ButtonLink href="/desk/tasks" variant="quiet">
              All tasks
            </ButtonLink>
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
        </Card>
      </div>
    </div>
  );
}
