import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDispatchBoardJobs } from "@/domains/jobs";
import {
  addBusinessDays as addDays,
  formatBusinessTime,
  BUSINESS_TIME_ZONE,
} from "@/lib/business-date";
import {
  findConflictingJobIds,
  dayKey,
  weekDays,
  dispatchAnchor,
  type DispatchableJob,
} from "@/domains/jobs/dispatch";
import { checklistProgress, parseChecklist } from "@/domains/jobs/checklist";
import { ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";

export const metadata = { title: "Dispatch" };

type View = "day" | "week" | "agenda";

function isView(value: string | undefined): value is View {
  return value === "day" || value === "week" || value === "agenda";
}

function boardLink(view: View, date: Date): string {
  return `/desk/dispatch?view=${view}&date=${dayKey(date)}`;
}

const formatTime = formatBusinessTime;

function jobTypeLabel(type: string): string {
  return type.replace(/_/g, " ").toLowerCase();
}

type BoardJob = Awaited<
  ReturnType<typeof getDispatchBoardJobs>
>["scheduled"][number];

function customerLabel(job: BoardJob): string {
  return job.customer
    ? (job.customer.user.name ?? job.customer.user.email)
    : "No customer on file";
}

function JobRow({
  job,
  conflicted,
  defaultMinutes,
}: {
  job: BoardJob;
  conflicted: boolean;
  defaultMinutes: number;
}) {
  const progress = checklistProgress(parseChecklist(job.checklist, job.type));

  return (
    <li>
      <Link
        href={`/desk/jobs/${job.id}`}
        className={`flex flex-col gap-1 rounded-control border px-3 py-3 text-sm hover:bg-subtle sm:flex-row sm:items-center sm:justify-between ${
          conflicted
            ? "border-warning-ink bg-warning-bg"
            : "border-line bg-surface"
        }`}
      >
        <div>
          <p className="font-medium text-ink">
            {job.scheduledAt && `${formatTime(new Date(job.scheduledAt))} — `}
            {jobTypeLabel(job.type)} — {customerLabel(job)}
          </p>
          <p className="text-ink-soft">
            {job.serviceAddress
              ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}`
              : "No address on file"}
          </p>
          <p className="text-ink-soft">
            {job.assignedTo
              ? `Assigned to ${job.assignedTo.name ?? job.assignedTo.email}`
              : "Nobody assigned"}
            {" · "}
            {job.durationMinutes
              ? `${job.durationMinutes} minutes`
              : `usual length (${defaultMinutes} minutes)`}
          </p>
        </div>
        <div className="text-xs text-ink-faint sm:text-right">
          {conflicted && (
            <p className="font-medium text-warning-ink">
              Double-booked around this time
              {job.assignedTo
                ? ` for ${job.assignedTo.name ?? job.assignedTo.email}`
                : " (no one assigned)"}
            </p>
          )}
          {progress.total > 0 && (
            <p>
              Checklist: {progress.done}/{progress.total}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
}

export default async function DispatchPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; date?: string }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const canScheduleJobs =
    session.user.role === "OWNER" || session.user.role === "ADMIN";
  const { view: rawView, date: rawDate } = await searchParams;
  const view: View = isView(rawView) ? rawView : "day";
  const anchor = dispatchAnchor(rawDate);

  let rangeStart: Date;
  let rangeEnd: Date;
  if (view === "day") {
    rangeStart = anchor;
    rangeEnd = addDays(anchor, 1);
  } else if (view === "week") {
    const days = weekDays(anchor);
    rangeStart = days[0];
    rangeEnd = addDays(days[6], 1);
  } else {
    rangeStart = anchor;
    rangeEnd = addDays(anchor, 14);
  }

  const { scheduled, unscheduled, conflictCandidates, defaultJobMinutes } =
    await getDispatchBoardJobs(rangeStart, rangeEnd);
  const conflicting = findConflictingJobIds(
    conflictCandidates.map(
      (job): DispatchableJob => ({
        id: job.id,
        scheduledAt: job.scheduledAt,
        assignedToUserId: job.assignedToUserId,
        durationMinutes: job.durationMinutes,
      }),
    ),
    defaultJobMinutes,
  );

  const jobsByDay = new Map<string, typeof scheduled>();
  for (const job of scheduled) {
    if (!job.scheduledAt) continue;
    const key = dayKey(new Date(job.scheduledAt));
    const list = jobsByDay.get(key) ?? [];
    list.push(job);
    jobsByDay.set(key, list);
  }

  return (
    <div>
      <PageHeader
        title="Dispatch"
        description="Schedule and review service work without changing the underlying job workflow."
        primaryAction={
          canScheduleJobs
            ? { href: "/desk/jobs/new", label: "Schedule a job" }
            : undefined
        }
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Dispatch view" className="flex flex-wrap gap-2">
          {(["day", "week", "agenda"] as View[]).map((item) => (
            <ButtonLink
              key={item}
              href={boardLink(item, anchor)}
              variant={view === item ? "primary" : "secondary"}
              aria-current={view === item ? "page" : undefined}
            >
              <span className="capitalize">{item}</span>
            </ButtonLink>
          ))}
        </nav>

        <nav aria-label="Change date" className="flex flex-wrap gap-2">
          <ButtonLink
            href={boardLink(
              view,
              addDays(
                anchor,
                view === "week" ? -7 : view === "agenda" ? -14 : -1,
              ),
            )}
            variant="secondary"
          >
            Earlier
          </ButtonLink>
          <ButtonLink
            href={boardLink(view, new Date())}
            variant="secondary"
          >
            Today
          </ButtonLink>
          <ButtonLink
            href={boardLink(
              view,
              addDays(anchor, view === "week" ? 7 : view === "agenda" ? 14 : 1),
            )}
            variant="secondary"
          >
            Later
          </ButtonLink>
        </nav>
      </div>

      {unscheduled.length > 0 && (
        <div className="mb-6">
          <Card
            title={`Unscheduled (${unscheduled.length})`}
            description="These jobs don't have a time on the calendar yet — open one to set it."
          >
            <ul className="space-y-2">
              {unscheduled.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  conflicted={false}
                  defaultMinutes={defaultJobMinutes}
                />
              ))}
            </ul>
          </Card>
        </div>
      )}

      {view === "day" && (
        <Card
          title={anchor.toLocaleDateString("en-US", {
            timeZone: BUSINESS_TIME_ZONE,
            weekday: "long",
            month: "long",
            day: "numeric",
          })}
        >
          {scheduled.length === 0 ? (
            <EmptyState title="Nothing scheduled for this day" />
          ) : (
            <ul className="space-y-2">
              {scheduled.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  conflicted={conflicting.has(job.id)}
                  defaultMinutes={defaultJobMinutes}
                />
              ))}
            </ul>
          )}
        </Card>
      )}

      {view === "week" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {weekDays(anchor).map((day) => {
            const key = dayKey(day);
            const dayJobs = jobsByDay.get(key) ?? [];
            return (
              <section
                key={key}
                className="rounded-card border border-line bg-surface p-3"
              >
                <Link
                  href={boardLink("day", day)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {day.toLocaleDateString("en-US", {
                    timeZone: BUSINESS_TIME_ZONE,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </Link>
                {dayJobs.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-faint">
                    Nothing scheduled
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {dayJobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          href={`/desk/jobs/${job.id}`}
                          className={`block rounded-control px-2 py-1 text-xs hover:bg-subtle ${
                            conflicting.has(job.id)
                              ? "bg-warning-bg text-warning-ink"
                              : "text-ink-soft"
                          }`}
                        >
                          {job.scheduledAt &&
                            formatTime(new Date(job.scheduledAt))}{" "}
                          — {jobTypeLabel(job.type)}
                          {conflicting.has(job.id) && " · conflict"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}

      {view === "agenda" && (
        <div className="space-y-6">
          {[...jobsByDay.keys()].length === 0 ? (
            <EmptyState title="Nothing scheduled in the next two weeks" />
          ) : (
            [...jobsByDay.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([key, dayJobs]) => (
                <Card
                  key={key}
                  title={new Date(
                    dayJobs[0].scheduledAt as Date,
                  ).toLocaleDateString("en-US", {
                    timeZone: BUSINESS_TIME_ZONE,
                    weekday: "long",
                    month: "long",
                    day: "numeric",
                  })}
                >
                  <ul className="space-y-2">
                    {dayJobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        conflicted={conflicting.has(job.id)}
                        defaultMinutes={defaultJobMinutes}
                      />
                    ))}
                  </ul>
                </Card>
              ))
          )}
        </div>
      )}
    </div>
  );
}
