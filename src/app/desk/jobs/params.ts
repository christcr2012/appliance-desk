import { z } from "zod";
import type { JobType } from "@prisma/client";
import type { VisitListParams, VisitSort, VisitTab, VisitWhen } from "@/domains/jobs/visits-list";

// AR-5 section 4: the Visits list URL state. One zod schema per KIT 5.1; unknown values fall back
// to defaults, never throw. Old links keep working: ?status=SCHEDULED|IN_PROGRESS maps to
// Upcoming, COMPLETED to Done, CANCELLED to Cancelled, and ?page= is ignored (cursor paging
// replaced offset paging).
const rawSchema = z.object({
  status: z.string().optional(),
  type: z.string().optional(),
  who: z.string().optional(),
  q: z.string().optional(),
  when: z.string().optional(),
  sort: z.string().optional(),
  cursor: z.string().optional(),
  page: z.string().optional(),
});

const TAB_BY_STATUS: Record<string, VisitTab> = {
  upcoming: "upcoming",
  "no-time": "no-time",
  done: "done",
  cancelled: "cancelled",
  SCHEDULED: "upcoming",
  IN_PROGRESS: "upcoming",
  COMPLETED: "done",
  CANCELLED: "cancelled",
};

const TYPE_BY_PARAM: Record<string, JobType> = {
  delivery: "DELIVERY",
  pickup: "REMOVAL",
  repair: "MAINTENANCE_VISIT",
  swap: "SWAP",
  installation: "INSTALLATION",
};

const WHEN_VALUES: Record<string, VisitWhen> = {
  "this-week": "this-week",
  "next-week": "next-week",
  "last-30": "last-30",
};

export function parseVisitsParams(input: {
  [key: string]: string | string[] | undefined;
}): VisitListParams {
  const raw = rawSchema.parse(input);
  const tab = TAB_BY_STATUS[raw.status ?? ""] ?? "upcoming";
  const sort: VisitSort =
    raw.sort === "soonest" || raw.sort === "latest"
      ? raw.sort
      : tab === "done" || tab === "cancelled"
        ? "latest"
        : "soonest";
  return {
    tab,
    type: raw.type ? TYPE_BY_PARAM[raw.type] : undefined,
    who: raw.who?.trim() ? raw.who.trim() : undefined,
    q: raw.q?.trim() ? raw.q.trim().slice(0, 80) : undefined,
    when: raw.when ? WHEN_VALUES[raw.when] : undefined,
    sort,
    cursor: raw.cursor,
  };
}
