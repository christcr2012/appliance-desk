import {
  getActivityPage,
  getActivityCount,
  getActivitySummary,
  describeAuditAction,
} from "@/domains/activity";
import {
  parsePage,
  paginationMeta,
  DEFAULT_PAGE_SIZE,
} from "@/domains/pagination";
import { Pagination } from "@/components/pagination";
import { FilterBar } from "@/components/desk/workspace";
import {
  Card,
  DataList,
  EmptyState,
  PageHeader,
  type DataListColumn,
} from "@/components/ui";

export const metadata = { title: "Activity" };

type Range = "today" | "week" | "all";
type ActivityRow = Awaited<ReturnType<typeof getActivityPage>>[number];

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
  const range: Range =
    rawRange === "today" || rawRange === "week" ? rawRange : "all";
  const since = rangeStart(range);

  const [totalCount, summary] = await Promise.all([
    getActivityCount(since),
    range !== "all"
      ? getActivitySummary(since!)
      : Promise.resolve([]),
  ]);
  const meta = paginationMeta(totalCount, parsePage(rawPage));
  const entries = await getActivityPage(
    meta.skip,
    meta.pageSize,
    since,
  );

  function href(page: number, forRange: Range = range) {
    const params = new URLSearchParams();
    if (forRange !== "all") params.set("range", forRange);
    if (page > 1) params.set("page", String(page));
    const qs = params.toString();
    return qs ? `/desk/activity?${qs}` : "/desk/activity";
  }

  const columns: DataListColumn<ActivityRow>[] = [
    {
      key: "activity",
      header: "Activity",
      primary: true,
      cell: (entry) => (
        <div>
          <p className="font-semibold text-ink">
            {entry.user?.name ??
              entry.user?.email ??
              "Unknown user"}{" "}
            — {describeAuditAction(entry.action)}
          </p>
          {entry.entityId && (
            <p className="mt-1 text-sm font-normal text-ink-soft">
              {entry.entityType} {entry.entityId}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "recorded",
      header: "Recorded",
      cell: (entry) =>
        new Date(entry.createdAt).toLocaleString(),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Activity"
        description={`A read-only record of who changed what and when across pricing, settings, leads, estimates, jobs, and billing. ${DEFAULT_PAGE_SIZE} per page.`}
      />

      <FilterBar
        label="Filter activity by time range"
        items={RANGE_TABS.map((tab) => ({
          label: tab.label,
          href: href(1, tab.value),
          active: range === tab.value,
        }))}
      />

      {range !== "all" && (
        <div className="mb-6">
          <Card
            title={
              range === "today"
                ? "Today by category"
                : "This week by category"
            }
          >
            {summary.length === 0 ? (
              <EmptyState
                title={
                  range === "today"
                    ? "Nothing recorded today yet"
                    : "Nothing recorded this week yet"
                }
                description="Audit activity will appear here as changes are recorded."
              />
            ) : (
              <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {summary.map((row) => (
                  <div key={row.category}>
                    <dt className="text-sm text-ink-soft">
                      {row.category}
                    </dt>
                    <dd className="mt-1 text-xl font-semibold text-ink">
                      {row.count}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </Card>
        </div>
      )}

      <DataList
        rows={entries}
        columns={columns}
        caption="Activity log"
        empty={
          <EmptyState
            title="Nothing recorded yet"
            description="Audit activity will appear here after tracked changes occur."
          />
        }
      />

      <Pagination
        page={meta.page}
        totalPages={meta.totalPages}
        totalCount={meta.totalCount}
        buildHref={(page) => href(page)}
      />
    </div>
  );
}
