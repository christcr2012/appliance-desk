import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getDispatchBoardJobs } from "@/domains/jobs";
import {
  addBusinessDays as addDays,
  formatBusinessTime,
  formatShortDate,
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
import { getAssignableTeamMembers } from "@/domains/staff";
import { jobTypeLabel } from "@/lib/status-labels";
import { visitPill, visitTitle } from "@/domains/jobs/words";
import { ButtonLink, Card, EmptyState } from "@/components/ui";
import { ScreenHeader, SidePanel, StatStrip, StatusPill, StatusTabs, Toaster } from "@/components/kit";
import { parseBoardParams, type BoardView } from "./params";
import { BoardRow, type BoardRowJob } from "./board-row";

export const metadata = { title: "Schedule" };

type DomainRow = Awaited<ReturnType<typeof getDispatchBoardJobs>>["scheduled"][number];

/** An instant as the Colorado clock reading a date-time box expects (YYYY-MM-DDTHH:mm). */
function denverLocalInput(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}

function toBoardRow(job: DomainRow): BoardRowJob {
  const progress = checklistProgress(parseChecklist(job.checklist, job.type));
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    version: job.version,
    scheduledAt: job.scheduledAt ? new Date(job.scheduledAt).toISOString() : null,
    scheduledAtLocal: job.scheduledAt ? denverLocalInput(new Date(job.scheduledAt)) : "",
    durationMinutes: job.durationMinutes,
    assignedToUserId: job.assignedToUserId,
    assignedLabel: job.assignedTo ? (job.assignedTo.name ?? job.assignedTo.email) : null,
    customerName: job.customer ? (job.customer.user.name ?? job.customer.user.email) : "No customer",
    customerPhone: job.customer?.phone ?? null,
    hasCustomer: Boolean(job.customer),
    address: job.serviceAddress ? `${job.serviceAddress.line1}, ${job.serviceAddress.city}` : null,
    checklistDone: progress.done,
    checklistTotal: progress.total,
    noShowAt: job.noShowAt ? new Date(job.noShowAt).toISOString() : null,
  };
}

function boardHref(view: BoardView, date: Date, who?: string, open?: string): string {
  const params = new URLSearchParams();
  params.set("view", view);
  params.set("date", dayKey(date));
  if (who) params.set("who", who);
  if (open) params.set("open", open);
  return `/desk/dispatch?${params.toString()}`;
}

function hourLabel(date: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    hour: "numeric",
  }).format(date);
}

function dayTitle(date: Date): string {
  return date.toLocaleDateString("en-US", {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = session.user.role;
  const ownerOrAdmin = role === "OWNER" || role === "ADMIN";
  const params = parseBoardParams(await searchParams);
  const anchor = dispatchAnchor(params.date);
  const now = new Date();

  let rangeStart: Date;
  let rangeEnd: Date;
  if (params.view === "day") {
    rangeStart = anchor;
    rangeEnd = addDays(anchor, 1);
  } else if (params.view === "week") {
    const days = weekDays(anchor);
    rangeStart = days[0]!;
    rangeEnd = addDays(days[6]!, 1);
  } else {
    rangeStart = anchor;
    rangeEnd = addDays(anchor, 14);
  }

  const [board, members] = await Promise.all([
    getDispatchBoardJobs(rangeStart, rangeEnd, params.who),
    ownerOrAdmin ? getAssignableTeamMembers() : Promise.resolve([]),
  ]);
  const { scheduled, unscheduled, conflictCandidates, defaultJobMinutes } = board;
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

  const memberOptions = members.map((m) => ({ id: m.id, label: m.name ?? m.email }));
  const scheduledRows = scheduled.map(toBoardRow);
  const waitingRows = unscheduled.map(toBoardRow);
  const waitingShown = waitingRows.slice(0, 50);
  const waitingCapped = waitingRows.length > 50;

  const jobsByDay = new Map<string, BoardRowJob[]>();
  for (const row of scheduledRows) {
    if (!row.scheduledAt) continue;
    const key = dayKey(new Date(row.scheduledAt));
    const list = jobsByDay.get(key) ?? [];
    list.push(row);
    jobsByDay.set(key, list);
  }

  const openRow = params.open
    ? [...scheduledRows, ...waitingRows].find((row) => row.id === params.open)
    : undefined;
  const openDomain = params.open
    ? [...scheduled, ...unscheduled].find((job) => job.id === params.open)
    : undefined;

  const stepDays = params.view === "week" ? 7 : params.view === "agenda" ? 14 : 1;
  const rowProps = {
    defaultMinutes: defaultJobMinutes,
    members: memberOptions,
    canSchedule: ownerOrAdmin,
  };

  function renderRow(row: BoardRowJob) {
    return (
      <BoardRow
        key={row.id}
        job={row}
        conflicted={conflicting.has(row.id)}
        canContact={ownerOrAdmin || row.assignedToUserId === session.user.id}
        openHref={boardHref(params.view, anchor, params.who, row.id)}
        {...rowProps}
      />
    );
  }

  return (
    <div>
      <ScreenHeader
        title="Schedule"
        primary={
          ownerOrAdmin
            ? { kind: "link", label: "Schedule a visit", href: "/desk/jobs/new" }
            : undefined
        }
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        The week at a glance — who is going where, and what still needs a time.
      </p>
      <Toaster />

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <StatusTabs
          label="Board view"
          param="view"
          current={params.view}
          items={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
            { value: "agenda", label: "Agenda" },
          ]}
        />
        <nav aria-label="Change date" className="flex flex-wrap items-center gap-2">
          <ButtonLink href={boardHref(params.view, addDays(anchor, -stepDays), params.who)} variant="secondary">
            Earlier
          </ButtonLink>
          <ButtonLink href={boardHref(params.view, now, params.who)} variant="secondary">
            Today
          </ButtonLink>
          <ButtonLink href={boardHref(params.view, addDays(anchor, stepDays), params.who)} variant="secondary">
            Later
          </ButtonLink>
          <span className="text-sm font-medium text-ink">
            {params.view === "day"
              ? dayTitle(anchor)
              : `${formatShortDate(rangeStart, now)} – ${formatShortDate(addDays(rangeEnd, -1), now)}`}
          </span>
        </nav>
        {ownerOrAdmin ? (
          <form method="get" action="/desk/dispatch" className="flex items-center gap-2 lg:ml-auto">
            <input type="hidden" name="view" value={params.view} />
            <input type="hidden" name="date" value={dayKey(anchor)} />
            <label htmlFor="board-who" className="text-sm font-medium text-ink-soft">
              Who
            </label>
            <select
              id="board-who"
              name="who"
              defaultValue={params.who ?? "everyone"}
              className="rounded-md border border-line-strong px-2 py-2 text-sm"
            >
              <option value="everyone">Everyone</option>
              <option value="mine">Mine</option>
              <option value="unassigned">Not assigned</option>
              {memberOptions.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.label}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="rounded-control border border-line-strong px-3 py-2 text-sm font-semibold text-ink hover:bg-subtle"
            >
              Show
            </button>
          </form>
        ) : null}
      </div>

      {waitingRows.length > 0 && (
        <details className="mb-6 rounded-card border border-line bg-surface" open={waitingRows.length <= 5}>
          <summary className="cursor-pointer px-4 py-3 font-medium text-ink">
            Waiting for a time ({waitingCapped ? "50+" : waitingRows.length})
          </summary>
          <div className="px-4 pb-4">
            <ul className="space-y-2">
              {waitingShown.map((row) => renderRow(row))}
            </ul>
            {waitingCapped ? (
              <p className="mt-3 text-sm">
                <Link href="/desk/jobs?status=no-time" className="font-semibold text-ink underline underline-offset-4">
                  50+ waiting — see them all in Visits
                </Link>
              </p>
            ) : null}
          </div>
        </details>
      )}

      {params.view === "day" && (
        <Card title={dayTitle(anchor)}>
          {scheduledRows.length === 0 ? (
            <EmptyState title="Nothing scheduled for this day" />
          ) : (
            <div className="space-y-4">
              {[...new Set(scheduledRows.map((row) => hourLabel(new Date(row.scheduledAt!))))].map((hour) => (
                <div key={hour}>
                  <h3 className="mb-2 text-sm font-bold text-ink-soft">{hour}</h3>
                  <ul className="space-y-2">
                    {scheduledRows
                      .filter((row) => hourLabel(new Date(row.scheduledAt!)) === hour)
                      .map((row) => renderRow(row))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {params.view === "week" && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {weekDays(anchor).map((day) => {
            const key = dayKey(day);
            const dayRows = jobsByDay.get(key) ?? [];
            return (
              <section key={key} className="rounded-card border border-line bg-surface p-3">
                <Link
                  href={boardHref("day", day, params.who)}
                  className="font-medium text-ink underline-offset-4 hover:underline"
                >
                  {day.toLocaleDateString("en-US", {
                    timeZone: BUSINESS_TIME_ZONE,
                    weekday: "short",
                    month: "short",
                    day: "numeric",
                  })}
                </Link>
                {dayRows.length === 0 ? (
                  <p className="mt-2 text-xs text-ink-faint">Nothing scheduled</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {dayRows.map((row) => (
                      <li key={row.id}>
                        <Link
                          href={`/desk/jobs/${row.id}`}
                          className={`block rounded-control px-2 py-1 text-xs hover:bg-subtle ${
                            conflicting.has(row.id) ? "bg-warning-bg text-warning-ink" : "text-ink-soft"
                          }`}
                        >
                          {row.scheduledAt ? `${formatBusinessTime(new Date(row.scheduledAt))} — ` : ""}
                          {jobTypeLabel(row.type)} · {row.customerName}
                          {conflicting.has(row.id) ? " · double-booked" : ""}
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

      {params.view === "agenda" && (
        <div className="space-y-6">
          {jobsByDay.size === 0 ? (
            <EmptyState title="Nothing scheduled in the next two weeks" />
          ) : (
            [...jobsByDay.entries()]
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([key, dayRows]) => (
                <Card key={key} title={dayTitle(new Date(dayRows[0]!.scheduledAt!))}>
                  <ul className="space-y-2">{dayRows.map((row) => renderRow(row))}</ul>
                </Card>
              ))
          )}
        </div>
      )}

      {openRow && openDomain ? (
        <SidePanel
          title={visitTitle(openDomain)}
          closeHref={boardHref(params.view, anchor, params.who)}
          fullHref={`/desk/jobs/${openRow.id}`}
        >
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill {...visitPill(openDomain)} />
              {conflicting.has(openRow.id) ? (
                <StatusPill label="Double-booked" tone="attention" info="double-booked" />
              ) : null}
            </div>
            <StatStrip
              items={[
                {
                  label: "When",
                  value: openDomain.scheduledAt
                    ? `${formatShortDate(new Date(openDomain.scheduledAt), now)} at ${formatBusinessTime(new Date(openDomain.scheduledAt))}`
                    : "No time yet",
                },
                { label: "Person", value: openRow.assignedLabel ?? "Not assigned" },
                {
                  label: "Length",
                  value: openDomain.durationMinutes
                    ? `${openDomain.durationMinutes} minutes`
                    : `Usual (${defaultJobMinutes} minutes)`,
                },
                {
                  label: "Appliances",
                  value: String(openDomain.appliances.length),
                },
              ]}
            />
            <p className="text-sm text-ink-soft">{openRow.address ?? "No address on file"}</p>
            {openRow.checklistTotal > 0 ? (
              <p className="text-sm text-ink-soft">
                Checklist: {openRow.checklistDone}/{openRow.checklistTotal} done
              </p>
            ) : null}
          </div>
        </SidePanel>
      ) : null}
    </div>
  );
}
