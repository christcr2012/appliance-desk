import Link from "next/link";
import type { JobStatus, JobType } from "@prisma/client";
import { jobTypeLabel } from "@/lib/status-labels";
import { JobTypeIcon } from "./visit-row";

/**
 * V-4: today's visits placed by their scheduled time on an 8 am to 7 pm axis. It shows only what Today already loads
 * (time, customer, type, status). Today's visit list does not load each visit's recorded length (that would need a
 * second read, which the design reserves for the owner to approve), so every block is drawn one hour long from its start. Visits with no time, or outside the axis, stay listed under it so none is ever hidden.
 */
export type TimelineVisit = {
  id: string;
  /** Minutes after midnight, Colorado time; null when the visit has no time. */
  minutes: number | null;
  timeLabel: string;
  customer: string;
  type: JobType;
  status: JobStatus;
  href: string;
  /** The visit's own length in minutes (its recorded length, else the business default); one hour when not given. */
  durationMinutes?: number;
};

export const TIMELINE_START_MINUTES = 8 * 60;
export const TIMELINE_END_MINUTES = 19 * 60;
const BLOCK_MINUTES = 60;
export const MIN_BLOCK_MINUTES = 30;

export type PlacedVisit = {
  visit: TimelineVisit;
  /** Minutes after the axis start. */
  top: number;
  height: number;
  lane: number;
  lanes: number;
};

/** Pure placement: which visits sit on the axis, side by side when they overlap, and which are listed beneath it. */
export function layoutDayVisits(visits: TimelineVisit[]): { placed: PlacedVisit[]; outside: TimelineVisit[] } {
  const outside: TimelineVisit[] = [];
  const onAxis: TimelineVisit[] = [];
  for (const visit of visits) {
    if (visit.minutes === null || visit.minutes < TIMELINE_START_MINUTES || visit.minutes >= TIMELINE_END_MINUTES) outside.push(visit);
    else onAxis.push(visit);
  }
  onAxis.sort((a, b) => (a.minutes as number) - (b.minutes as number) || a.id.localeCompare(b.id));

  const placed: PlacedVisit[] = [];
  let cluster: PlacedVisit[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const lanes = Math.max(1, laneEnds.length);
    for (const item of cluster) item.lanes = lanes;
    cluster = [];
    laneEnds = [];
  };
  for (const visit of onAxis) {
    const start = visit.minutes as number;
    if (start >= clusterEnd && cluster.length > 0) closeCluster();
    // A visit that starts in the last half hour keeps a readable block; the axis has room beneath 7 pm for it.
    const height = Math.max(MIN_BLOCK_MINUTES, Math.min(visit.durationMinutes ?? BLOCK_MINUTES, TIMELINE_END_MINUTES + MIN_BLOCK_MINUTES - start));
    let lane = laneEnds.findIndex((end) => end <= start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = start + height;
    clusterEnd = Math.max(clusterEnd, start + height);
    const item: PlacedVisit = { visit, top: start - TIMELINE_START_MINUTES, height, lane, lanes: 1 };
    cluster.push(item);
    placed.push(item);
  }
  closeCluster();
  return { placed, outside };
}

/** The word shown for a visit's state: Done, In progress, Next, or its time. */
export function visitStateWord(visit: TimelineVisit, nextId: string | null): string {
  if (visit.status === "COMPLETED") return "Done";
  if (visit.status === "IN_PROGRESS") return "In progress";
  if (visit.id === nextId) return "Next";
  return visit.timeLabel;
}

const HOURS = Array.from({ length: (TIMELINE_END_MINUTES - TIMELINE_START_MINUTES) / 60 + 1 }, (_, i) => 8 + i);
const hourLabel = (hour: number) => `${hour % 12 === 0 ? 12 : hour % 12} ${hour < 12 ? "am" : "pm"}`;
const ROW_REM = 4;

export function DayTimeline({
  visits,
  nowMinutes,
  nextId,
}: {
  visits: TimelineVisit[];
  /** Minutes after midnight, Colorado time, right now. */
  nowMinutes: number;
  nextId: string | null;
}) {
  const { placed, outside } = layoutDayVisits(visits);
  const total = TIMELINE_END_MINUTES - TIMELINE_START_MINUTES;
  const showNow = nowMinutes >= TIMELINE_START_MINUTES && nowMinutes <= TIMELINE_END_MINUTES;
  const rem = (minutes: number) => `${(minutes / 60) * ROW_REM}rem`;

  return (
    <div data-testid="day-timeline">
      <div className="relative" style={{ height: rem(total + MIN_BLOCK_MINUTES) }} role="list" aria-label="Today's visits by time">
        {HOURS.map((hour) => (
          <div
            key={hour}
            aria-hidden="true"
            className="absolute inset-x-0 flex items-start border-t border-hairline"
            style={{ top: rem((hour - 8) * 60) }}
          >
            <span className="-mt-3 w-14 shrink-0 bg-surface pr-2 text-xs tabular-nums text-ink-soft">{hourLabel(hour)}</span>
          </div>
        ))}
        <div className="absolute inset-y-0 left-16 right-0">
          {placed.map(({ visit, top, height, lane, lanes }) => {
            const word = visitStateWord(visit, nextId);
            const isNext = word === "Next" || word === "In progress";
            const done = visit.status === "COMPLETED";
            return (
              <Link
                key={visit.id}
                role="listitem"
                href={visit.href}
                className={`absolute block overflow-hidden rounded-control border-l-4 px-3 py-1.5 text-sm hover:bg-subtle ${
                  done ? "border-line-strong bg-subtle text-ink-soft" : isNext ? "border-primary bg-primary-soft text-ink ring-2 ring-primary" : "border-primary bg-surface text-ink ring-1 ring-line"
                }`}
                style={{
                  top: rem(top),
                  height: `calc(${rem(height)} - 0.25rem)`,
                  left: `${(lane / lanes) * 100}%`,
                  width: `calc(${100 / lanes}% - 0.25rem)`,
                }}
              >
                <span className="flex items-center gap-2 font-semibold">
                  <JobTypeIcon type={visit.type} className="h-4 w-4 shrink-0" />
                  <span className="truncate">{visit.customer}</span>
                </span>
                <span className="block truncate text-xs">
                  {jobTypeLabel(visit.type)} · <span className="font-semibold">{word}</span>
                </span>
              </Link>
            );
          })}
          {showNow ? (
            <div
              aria-hidden="true"
              data-testid="timeline-now"
              className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
              style={{ top: rem(nowMinutes - TIMELINE_START_MINUTES) }}
            >
              <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-semibold text-canvas">Now</span>
              <span className="h-0.5 flex-1 bg-danger" />
            </div>
          ) : null}
        </div>
      </div>

      {outside.length > 0 ? (
        <div className="mt-4 border-t border-hairline pt-4">
          <p className="text-sm font-semibold text-ink">Not on the timeline</p>
          <ul className="mt-2 divide-y divide-hairline">
            {outside.map((visit) => (
              <li key={visit.id}>
                <Link href={visit.href} className="flex min-h-11 flex-wrap items-center gap-x-3 py-2 text-sm text-ink hover:bg-subtle">
                  <span className="font-semibold tabular-nums">{visit.timeLabel}</span>
                  <span>{visit.customer}</span>
                  <span className="text-ink-soft">{jobTypeLabel(visit.type)} · {visitStateWord(visit, nextId)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
