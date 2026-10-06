import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDispatchBoardJobs } from "@/domains/jobs";
import {
  addBusinessDays as addDays,
  formatBusinessTime,
  BUSINESS_TIME_ZONE,
} from "@/lib/business-date";
import { PlusIcon } from "@/components/icons/status-icons";
import {
  findConflictingJobIds,
  dayKey,
  weekDays,
  dispatchAnchor,
  type DispatchableJob,
} from "@/domains/jobs/dispatch";
import { checklistProgress, parseChecklist } from "@/domains/jobs/checklist";
import { DeliveryServiceIcon } from "@/components/icons/service-icons";

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

function JobRow({ job, conflicted, defaultMinutes }: { job: BoardJob; conflicted: boolean; defaultMinutes: number }) {
  const progress = checklistProgress(parseChecklist(job.checklist, job.type));
  return (
    <li>
      <Link
        href={`/desk/jobs/${job.id}`}
        className={`flex flex-col gap-1 rounded-md border px-3 py-2 text-sm hover:bg-canvas sm:flex-row sm:items-center sm:justify-between ${
          conflicted
            ? "border-amber-300 bg-amber-50"
            : "border-line bg-white"
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
            {job.assignedTo ? `Assigned to ${job.assignedTo.name ?? job.assignedTo.email}` : "Nobody assigned"}
            {" · "}
            {job.durationMinutes ? `${job.durationMinutes} minutes` : `usual length (${defaultMinutes} minutes)`}
          </p>
        </div>
        <div className="text-xs text-ink-faint sm:text-right">
          {conflicted && (
            <p className="font-medium text-amber-700">
              ⚠ Double-booked around this time
              {job.assignedTo ? ` for ${job.assignedTo.name ?? job.assignedTo.email}` : " (no one assigned)"}
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
    conflictCandidates.map((j): DispatchableJob => ({
      id: j.id,
      scheduledAt: j.scheduledAt,
      assignedToUserId: j.assignedToUserId,
      durationMinutes: j.durationMinutes,
    })),
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <DeliveryServiceIcon className="h-5 w-5 text-ink-faint" />
          Dispatch
        </h1>
        {canScheduleJobs && (
          <Link
            href="/desk/jobs/new"
            className="inline-flex items-center gap-1 rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action"
          >
            <PlusIcon className="h-4 w-4" />
            Schedule a job
          </Link>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Dispatch view" className="flex gap-2">
          {(["day", "week", "agenda"] as View[]).map((v) => (
            <Link
              key={v}
              href={boardLink(v, anchor)}
              aria-current={view === v ? "page" : undefined}
              className={`rounded-full border px-3 py-1 text-sm capitalize ${
                view === v
                  ? "border-action bg-action text-on-action"
                  : "border-line-strong text-ink-soft hover:border-line-strong"
              }`}
            >
              {v}
            </Link>
          ))}
        </nav>
        <nav
          aria-label="Change date"
          className="flex items-center gap-2 text-sm"
        >
          <Link
            href={boardLink(
              view,
              addDays(
                anchor,
                view === "week" ? -7 : view === "agenda" ? -14 : -1,
              ),
            )}
            className="rounded-md border border-line-strong px-2 py-1 text-ink-soft hover:border-line-strong"
          >
            &larr; Earlier
          </Link>
          <Link
            href={boardLink(view, new Date())}
            className="rounded-md border border-line-strong px-2 py-1 text-ink-soft hover:border-line-strong"
          >
            Today
          </Link>
          <Link
            href={boardLink(
              view,
              addDays(anchor, view === "week" ? 7 : view === "agenda" ? 14 : 1),
            )}
            className="rounded-md border border-line-strong px-2 py-1 text-ink-soft hover:border-line-strong"
          >
            Later &rarr;
          </Link>
        </nav>
      </div>

      {unscheduled.length > 0 && (
        <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
          <h2 className="font-medium text-ink">
            Unscheduled ({unscheduled.length})
          </h2>
          <p className="mt-1 text-sm text-ink-soft">
            These jobs don&apos;t have a time on the calendar yet — open one to
            set it.
          </p>
          <ul className="mt-3 space-y-2">
            {unscheduled.map((job) => (
              <JobRow key={job.id} job={job} conflicted={false} defaultMinutes={defaultJobMinutes} />
            ))}
          </ul>
        </div>
      )}

      {view === "day" && (
        <div className="mt-6">
          <h2 className="font-medium text-ink">
            {anchor.toLocaleDateString("en-US", {
              timeZone: BUSINESS_TIME_ZONE,
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </h2>
          {scheduled.length === 0 ? (
            <p className="mt-2 text-sm text-ink-soft">
              Nothing scheduled for this day.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
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
        </div>
      )}

      {view === "week" && (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {weekDays(anchor).map((day) => {
            const key = dayKey(day);
            const dayJobs = jobsByDay.get(key) ?? [];
            return (
              <div
                key={key}
                className="rounded-lg border border-line bg-white p-3"
              >
                <Link
                  href={boardLink("day", day)}
                  className="font-medium text-ink hover:underline"
                >
                  {day.toLocaleDateString("en-US", {
                    timeZone: BUSINESS_TIME_ZONE,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </Link>
                {dayJobs.length === 0 ? (
                  <p className="mt-1 text-xs text-ink-faint">
                    Nothing scheduled
                  </p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {dayJobs.map((job) => (
                      <li key={job.id}>
                        <Link
                          href={`/desk/jobs/${job.id}`}
                          className={`block rounded px-1.5 py-1 text-xs hover:bg-canvas ${
                            conflicting.has(job.id)
                              ? "bg-amber-50 text-amber-800"
                              : "text-ink-soft"
                          }`}
                        >
                          {job.scheduledAt &&
                            formatTime(new Date(job.scheduledAt))}{" "}
                          — {jobTypeLabel(job.type)}
                          {conflicting.has(job.id) && " ⚠"}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}

      {view === "agenda" && (
        <div className="mt-6 space-y-6">
          {[...jobsByDay.keys()].length === 0 ? (
            <p className="text-sm text-ink-soft">
              Nothing scheduled in the next two weeks.
            </p>
          ) : (
            [...jobsByDay.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([key, dayJobs]) => (
                <div key={key}>
                  <h2 className="font-medium text-ink">
                    {new Date(
                      dayJobs[0].scheduledAt as Date,
                    ).toLocaleDateString("en-US", {
                      timeZone: BUSINESS_TIME_ZONE,
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                    })}
                  </h2>
                  <ul className="mt-2 space-y-2">
                    {dayJobs.map((job) => (
                      <JobRow
                        key={job.id}
                        job={job}
                        conflicted={conflicting.has(job.id)}
                        defaultMinutes={defaultJobMinutes}
                      />
                    ))}
                  </ul>
                </div>
              ))
          )}
        </div>
      )}
    </div>
  );
}
