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
import { snoozeTodo, unsnoozeTodo } from "@/domains/exceptions/todo";
import { getDueTaskSummary } from "@/domains/tasks/workspace";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";
import {
  businessDateKey,
  addBusinessDays,
  formatBusinessDate,
  formatBusinessTime,
  businessMinuteOfDay,
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
  DayTimeline,
} from "@/components/ui";
import { TaskRow } from "../tasks/task-row";
import { getSetupChecklist } from "@/domains/setup/checklist";
import { SetupCard } from "./setup-card";
import { getBudgetPlanning } from "@/domains/budget/planning";
import Link from "next/link";
import { formatMoney } from "@/lib/money-ui";
import { getWorkspace, describeSavedView, savedViewHref, usablePins } from "@/domains/workspace";
import { visibleOwnerActions } from "@/lib/owner-actions";

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
  TAX_SETUP_CHECK: "Tax setup to check against SUTS",
  BUSINESS_PAPERWORK: "Business paperwork",
  TAX_AMENDMENT_DUE: "Tax amendments requiring review",
  TAX_FILING_NOT_READY: "Tax returns not ready to file",
  ACQUISITION_TAX_REVIEW: "Appliance purchase tax needs review",
  PURCHASE_USE_TAX_DUE: "Consumer use tax to file",
  RETAIL_DELIVERY_FEE: "Retail delivery fee needs review",
  STALE_RESERVATION: "Reservation expired",
  PAST_DUE_INVOICE: "Past due",
  HELD_PAYMENT_DECISION: "Held payment — decide",
  DEPOSIT_DECISION: "Deposit — decide",
  NEW_LEAD_CONTACT: "New lead — contact",
  LEAD_FOLLOW_UP: "Lead follow-up",
  APPROVED_QUOTE: "Approved quote — make rental",
  SIGNING_PAYMENT_DUE: "Signing payment to collect",
  UNSIGNED_AGREEMENT: "Agreement not signed yet",
  CANCELLATION_REFUND_DUE: "Cancellation refund owed",
  SIGNED_DELIVERY_UNSCHEDULED: "Signed rental — schedule delivery",
  RENTAL_ENDING_SOON: "Rental ending soon — decide what happens next",
  PICKUP_UNSCHEDULED: "Pickup to schedule",
  RETIRED_APPLIANCE_PLAN: "Retired appliances to decide on",
  APPROVAL_REQUEST: "Requests waiting for your approval",
  GOAL_BEHIND: "Behind on a monthly goal",
  IDLE_APPLIANCES: "Appliances sitting idle",
  LOW_UTILIZATION: "Fleet is mostly sitting idle",
  VISIT_NEEDS_ASSIGNMENT: "Visit needs a technician or time",
  CLEANING_NEEDED: "Appliance to clean",
  OVERDUE_JOB: "Overdue job",
  UNREVIEWED_MAINTENANCE_REQUEST: "Needs review",
  UNINSPECTED_RETURN: "Needs inspection",
  OLD_SET_APPLIANCE: "Old set record to split",
  OUT_OF_SERVICE: "Out for repair, no replacement",
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

async function snoozeToDoAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const key = formData.get("key");
  const until = formData.get("until");
  const reason = formData.get("reason");
  if (typeof key !== "string" || typeof until !== "string" || typeof reason !== "string")
    throw new Error("Complete the snooze form.");
  const overview = await getExceptionOverview();
  await snoozeTodo({ key, until, reason, actorUserId: session.user.id,
    active: [...overview.items, ...overview.snoozed] });
  revalidatePath("/desk/today");
}
async function resumeToDoAction(formData: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const key = formData.get("key");
  if (typeof key !== "string") throw new Error("Invalid To do item.");
  await unsnoozeTodo({ key, actorUserId: session.user.id });
  revalidatePath("/desk/today");
}

export default async function TodayPage({ searchParams }: { searchParams?: Promise<{ screen?: string }> } = {}) {
  // ACC-5: sent here when a job role does not include the screen they tried to open.
  const notInJobRole = (await searchParams)?.screen === "not-in-job-role";
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = (session.user as { role?: string }).role ?? "";
  const canCreateVisit = role === "OWNER" || role === "ADMIN";
  const now = new Date();

  // The first-time setup checklist is for the owner only. getSetupChecklist refuses anyone else itself;
  // the role test here just avoids asking. A failure must never take Today down, so it only hides the card.
  const setupChecklist = role === "OWNER"
    ? await getSetupChecklist(session.user.id).catch((error: unknown) => {
        console.error("Setup checklist unavailable:", error instanceof Error ? error.message : "unknown error");
        return null;
      })
    : null;

  const budgetAttention=role==="OWNER"||role==="ADMIN"
    ? await getBudgetPlanning(session.user.id,businessDateKey(now)).then(data=>({
      sourceStatus:data.sourceStatus,review:data.sourceReasons.slice(0,3),
      items:data.upcoming.filter(x=>x.unpaidCents>0&&x.dueOn<=businessDateKey(
       addBusinessDays(now,30))).slice(0,15),
      shortages:data.envelopes.filter(x=>x.needCents>0||x.balanceCents<0).slice(0,12),
      revision:data.revision
    })).catch(()=>null)
    :null;
  const [{ items: allExceptions, snoozed, truncated: allTruncated }, jobs, followUps, openRequests] =
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

  // O-7: a private workspace for the owner and admins. A problem reading it only hides the shortcuts; it never hides work.
  // Only the optional notes (goal, idle appliances, low use) can be hidden; every other item always shows.
  const workspace = role === "OWNER" || role === "ADMIN"
    ? await getWorkspace(session.user.id).catch(() => null)
    : null;
  const hiddenOptional = new Set(workspace?.prefs.hiddenOptionalCardIds ?? []);
  const exceptions = allExceptions.filter((item) => !hiddenOptional.has(item.category));
  const truncated = allTruncated.filter((item) => !hiddenOptional.has(item.category));
  const hiddenNoteCount = allExceptions.filter((item) => hiddenOptional.has(item.category)).length;
  const myPins = workspace ? usablePins(workspace.prefs, visibleOwnerActions(role)) : [];
  const mySavedViews = workspace?.prefs.savedViews ?? [];

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
      {notInJobRole && (
        <p role="status" className="mb-4 rounded-card border border-line bg-subtle p-3 text-sm text-ink">
          That screen is not part of your job role. Ask the owner if you need it.
        </p>
      )}
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

      {myPins.length + mySavedViews.length > 0 ? (
        <nav aria-label="My shortcuts" className="mb-6 rounded-card border border-line p-4">
          <p className="mb-2 text-sm font-semibold text-ink">My shortcuts</p>
          <ul className="flex flex-wrap gap-2">
            {myPins.map((a) => (
              <li key={a.id}><Link href={a.href} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm underline">{a.label}</Link></li>
            ))}
            {mySavedViews.map((v) => (
              <li key={v.id}><Link href={savedViewHref(v)} title={describeSavedView(v)} className="inline-flex min-h-11 items-center rounded-md border px-3 text-sm underline">{v.label}</Link></li>
            ))}
          </ul>
        </nav>
      ) : null}
      {hiddenNoteCount > 0 ? (
        <p className="mb-4 text-sm text-ink-soft">
          {hiddenNoteCount} optional note{hiddenNoteCount === 1 ? " is" : "s are"} hidden. <Link href="/desk/control-center#my-workspace" className="underline">Show again</Link>
        </p>
      ) : null}
      {setupChecklist ? <SetupCard checklist={setupChecklist} /> : null}
      {budgetAttention&&<section aria-label="Budget source and upcoming cost attention"
       className="mb-6 space-y-2 rounded border border-border p-4">
       <h2 className="text-lg font-semibold">Budget and known upcoming bills</h2>
       <p role="status">Verified bank source status: {budgetAttention.sourceStatus}. Budget notices do not initiate payments or assign cash.</p>
       {budgetAttention.review.map((x,i)=><p key={i}>{x}</p>)}
       {budgetAttention.shortages.map(row=><p key={row.id}>
        <strong>{row.name}</strong>: saved {formatMoney(row.balanceCents)}, more needed {formatMoney(row.needCents)}
       </p>)}
       {budgetAttention.items.map(row=><p key={row.id}>
        Unpaid {row.name} — {formatMoney(row.unpaidCents)} due {row.dueOn} ({row.quality})
       </p>)}
       <Link href="/desk/books/budget?tab=plan" className="inline-block underline p-2">Review bills, source proof and funding proposal</Link>
      </section>}

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
            <>
              <div className="hidden md:block">
                <DayTimeline
                  nextId={next?.id ?? null}
                  nowMinutes={businessMinuteOfDay(now)}
                  visits={visits.map((job) => ({
                    id: job.id,
                    minutes: job.scheduledAt ? businessMinuteOfDay(job.scheduledAt) : null,
                    timeLabel: job.scheduledAt ? formatBusinessTime(job.scheduledAt) : "Time not set",
                    customer: job.customer?.user.name ?? job.customer?.user.email ?? "Internal job",
                    type: job.type,
                    status: job.status,
                    href: `/desk/jobs/${job.id}`,
                    durationMinutes: job.durationMinutes,
                  }))}
                />
              </div>
              <ul className="md:hidden">
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
            </>
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
            snoozeAction={canCreateVisit ? snoozeToDoAction : undefined}
          />
        </Card>
      </div>

      {snoozed.length > 0 ? (
        <details className="mt-6 rounded-card border border-line p-4">
          <summary className="cursor-pointer font-semibold text-ink">Snoozed To do items ({snoozed.length})</summary>
          <AttentionList
            groups={[{ category: "snoozed", title: "Paused until their resume date", total: snoozed.length, items: snoozed }]}
            unsnoozeAction={canCreateVisit ? resumeToDoAction : undefined}
          />
        </details>
      ) : null}

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
