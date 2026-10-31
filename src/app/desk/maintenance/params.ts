import { z } from "zod";
import type { RepairListParams, RepairSort, RepairTab } from "@/domains/maintenance/list";

// AR-5 section 8: the Repairs list URL state. Unknown values fall back to defaults, never
// throw. Old links keep working: ?status=SUBMITTED maps to New, REVIEWING / SCHEDULED /
// IN_PROGRESS to Open, RESOLVED to Fixed, CLOSED to Closed, and ?page= is ignored.
const rawSchema = z.object({
  status: z.string().optional(),
  priority: z.string().optional(),
  q: z.string().optional(),
  sort: z.string().optional(),
  cursor: z.string().optional(),
  page: z.string().optional(),
});

const TAB_BY_STATUS: Record<string, RepairTab> = {
  open: "open",
  new: "new",
  fixed: "fixed",
  closed: "closed",
  SUBMITTED: "new",
  REVIEWING: "open",
  SCHEDULED: "open",
  IN_PROGRESS: "open",
  RESOLVED: "fixed",
  CLOSED: "closed",
};

export function parseRepairsParams(input: {
  [key: string]: string | string[] | undefined;
}): RepairListParams {
  const raw = rawSchema.parse(input);
  const sort: RepairSort =
    raw.sort === "oldest" || raw.sort === "priority" ? raw.sort : "newest";
  return {
    tab: TAB_BY_STATUS[raw.status ?? ""] ?? "open",
    priority: raw.priority === "urgent" ? "URGENT" : raw.priority === "high" ? "HIGH" : undefined,
    q: raw.q?.trim() ? raw.q.trim().slice(0, 80) : undefined,
    sort,
    cursor: raw.cursor,
  };
}
