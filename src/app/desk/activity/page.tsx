import Link from "next/link";
import {
  getActivityPage,
  getActivityCount,
  getActivitySummary,
  describeAuditAction,
} from "@/domains/activity";
import { parsePage, paginationMeta, DEFAULT_PAGE_SIZE } from "@/domains/pagination";
import { Pagination } from "@/components/pagination";

export const metadata = { title: "Activity" };

type Range = "today" | "week" | "all";

// "Today"/"This week" quick filters + a category breakdown added
// 2026-09-29 (Chris's CRM brainstorm — a combined "what did I actually
// do" view, without checking Leads/Estimates/Jobs/Billing separately —
// see docs/DECISIONS.md). Built on the AuditLog this page already read;
// no new tracking needed.
function rangeStart(range: Range): Date | undefined {
  if (range === "all") return undefined;
  const start = new Date();
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(start.getDate() - 7);
  }
  return start;
}

const RANGE_TABS: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "all", label: "All time" },
];

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; range?: string }>;
}) {
  const { page: rawPage, range: rawRange } = await searchParams;
  const range: Range = rawRange === "today" || rawRange === "week" ? rawRange : "all";
  const since = rangeStart(range);

  const [totalCount, summary] = await Promise.all([
    getActivityCount(since),
    range !== "all" ? getActivitySummary(since!) : Promise.resolve([]),
  ]);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const entries = await getActivityPage(meta.skip, meta.pageSize, since);

  function href(page: number, forRange: Range = range) {
    const params = new URLSearchParams();
    if (forRange !== "all") params.set("range", forRange);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/activity?${qs}` : "/desk/activity";
  }

  return (
    <div>
      <h1 className="text-xl font-semibold">Activity</h1>
      <p className="mt-1 text-sm text-ink-soft">
        A record of who changed what, and when — pricing changes, settings
        updates, lead activity, estimates, jobs, and billing.{" "}
        {DEFAULT_PAGE_SIZE} per page.
      </p>

      <nav aria-label="Filter activity by time range" className="mt-4 flex flex-wrap gap-2">
        {RANGE_TABS.map((tab) => (
          <Link
            key={tab.value}
            href={href(1, tab.value)}
            aria-current={range === tab.value ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${
              range === tab.value
                ? "border-action bg-action text-on-action"
                : "border-line-strong text-ink-soft hover:border-line-strong"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {range !== "all" && (
        <div className="mt-4 rounded-lg border border-line bg-white p-4">
          {summary.length === 0 ? (
            <p className="text-sm text-ink-soft">
              Nothing recorded {range === "today" ? "today" : "this week"} yet.
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-ink-soft">
              {summary.map((row) => (
                <span key={row.category}>
                  <span className="font-medium text-ink">{row.count}</span> {row.category}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="mt-8 text-sm text-ink-soft">Nothing recorded yet.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-white">
          {entries.map((entry) => (
            <li key={entry.id} className="px-4 py-3 text-sm">
              <p className="text-ink">
                <span className="font-medium">
                  {entry.user?.name ?? entry.user?.email ?? "Unknown user"}
                </span>{" "}
                — {describeAuditAction(entry.action)}
                {entry.entityId ? (
                  <span className="text-ink-faint">
                    {" "}
                    ({entry.entityType} {entry.entityId})
                  </span>
                ) : null}
              </p>
              <p className="text-ink-faint">
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(p) => href(p)}
      />
    </div>
  );
}
