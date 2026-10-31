import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getRepairCounts, getRepairRequests, type RepairTab } from "@/domains/maintenance/list";
import { formatBusinessTime, relativeBusinessDay } from "@/lib/business-date";
import { REPAIR_PILL, repairPriorityChip } from "@/domains/jobs/words";
import {
  DataTable,
  ScreenHeader,
  StatusPill,
  StatusTabs,
  Toolbar,
  type Column,
  type FilterDef,
} from "@/components/kit";
import { EmptyState } from "@/components/kit";
import { parseRepairsParams } from "./params";
import type { RepairRow } from "@/domains/maintenance/list";

export const metadata = { title: "Repairs" };

const EMPTY_BY_TAB: Record<RepairTab, string> = {
  open: "No open repair requests.",
  new: "No new requests.",
  fixed: "Nothing fixed yet.",
  closed: "No closed requests.",
};

export default async function RepairsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const ownerOrAdmin = session.user.role === "OWNER" || session.user.role === "ADMIN";
  const raw = await searchParams;
  // The kit table's row click convention sets ?open=<id>; repair requests have no side
  // panel, so an ?open= link goes straight to the record (as this page has always done).
  if (typeof raw.open === "string" && raw.open) {
    redirect(`/desk/maintenance/${encodeURIComponent(raw.open)}`);
  }
  const params = parseRepairsParams(raw);
  const now = new Date();
  const [list, counts] = await Promise.all([
    getRepairRequests(params),
    getRepairCounts(params),
  ]);
  const filtered = Boolean(params.q || params.priority);

  function repairsHref(overrides: Partial<typeof params> & { cursor?: string | null }): string {
    const search = new URLSearchParams();
    search.set("status", overrides.tab ?? params.tab);
    const priority = "priority" in overrides ? overrides.priority : params.priority;
    if (priority) search.set("priority", priority === "URGENT" ? "urgent" : "high");
    const q = "q" in overrides ? overrides.q : params.q;
    if (q) search.set("q", q);
    const sort = overrides.sort ?? params.sort;
    if (sort !== "newest") search.set("sort", sort);
    if (overrides.cursor) search.set("cursor", overrides.cursor);
    return `/desk/maintenance?${search.toString()}`;
  }

  const filters: FilterDef[] = [
    {
      kind: "select",
      param: "priority",
      label: "Priority",
      options: [
        { value: "urgent", label: "Urgent only" },
        { value: "high", label: "High only" },
      ],
    },
  ];
  const sorts = [
    { value: "newest", label: "Newest first" },
    { value: "oldest", label: "Oldest first" },
    { value: "priority", label: "Priority first" },
  ];

  const columns: Column<RepairRow>[] = [
    {
      key: "request",
      header: "Request",
      cell: (row) => (
        <div>
          <span className="font-semibold text-ink">{row.customerName}</span>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {row.applianceLabel ?? "General"} · {row.problemExcerpt}
          </p>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const pill = REPAIR_PILL[row.status];
        const chip = repairPriorityChip(row.priority);
        return (
          <span className="flex flex-wrap items-center gap-1.5">
            <StatusPill label={pill.label} tone={pill.tone} />
            {chip ? <StatusPill label={chip.label} tone={chip.tone} /> : null}
          </span>
        );
      },
    },
    {
      key: "reported",
      header: "Reported",
      cell: (row) => (
        <div>
          <span>Reported {relativeBusinessDay(row.openedAt, now)}</span>
          <p className="mt-1 text-sm font-normal text-ink-soft">
            {row.nextVisit
              ? `Next visit ${relativeBusinessDay(row.nextVisit.scheduledAt, now)} at ${formatBusinessTime(row.nextVisit.scheduledAt)}`
              : "No visit yet"}
          </p>
        </div>
      ),
    },
  ];

  return (
    <div>
      <ScreenHeader title="Repairs" list />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Repair requests from customers — what is broken, how urgent it is, and whether a visit is booked.
      </p>

      <div className="flex flex-col gap-3">
        <StatusTabs
          label="Repair status"
          param="status"
          current={params.tab}
          items={[
            { value: "open", label: "Open", count: counts.open },
            { value: "new", label: "New", count: counts.new, hideWhenZero: true },
            { value: "fixed", label: "Fixed", count: counts.fixed },
            { value: "closed", label: "Closed", count: counts.closed },
          ]}
        />
        <Toolbar
          search={{
            param: "q",
            placeholder: "Customer, problem or appliance number",
            label: "Search repairs",
          }}
          filters={filters}
          sorts={sorts}
          currentSort={params.sort}
        />
      </div>

      <div className="mt-2">
        <DataTable
          rows={list.rows}
          rowKey={(row) => row.id}
          columns={columns}
          caption="Repair requests"
          rowHref={(row) => `/desk/maintenance/${row.id}`}
          rowActions={(row) =>
            ownerOrAdmin &&
            (row.status === "SUBMITTED" || row.status === "REVIEWING") &&
            !row.hasOpenVisit
              ? [
                  {
                    kind: "link" as const,
                    label: "Schedule a visit",
                    href: `/desk/jobs/new?maintenanceRequestId=${row.id}`,
                  },
                ]
              : []
          }
          mobileCard={(row) => {
            const pill = REPAIR_PILL[row.status];
            const chip = repairPriorityChip(row.priority);
            return (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-ink">{row.customerName}</span>
                  <span className="flex items-center gap-1.5">
                    {chip ? <StatusPill label={chip.label} tone={chip.tone} /> : null}
                    <StatusPill label={pill.label} tone={pill.tone} />
                  </span>
                </div>
                <span className="text-sm text-ink-soft">
                  {row.applianceLabel ?? "General"} · {row.problemExcerpt}
                </span>
                <span className="text-sm text-ink-soft">
                  Reported {relativeBusinessDay(row.openedAt, now)}
                  {" · "}
                  {row.nextVisit
                    ? `Next visit ${relativeBusinessDay(row.nextVisit.scheduledAt, now)}`
                    : "No visit yet"}
                </span>
              </div>
            );
          }}
          empty={
            filtered ? (
              <EmptyState
                title="No repairs match."
                action={{ kind: "link", label: "Clear filters", href: repairsHref({ q: undefined, priority: undefined }) }}
              />
            ) : (
              <EmptyState title={EMPTY_BY_TAB[params.tab]} />
            )
          }
          nextHref={list.nextCursor ? repairsHref({ cursor: list.nextCursor }) : null}
          capReached={list.capped}
        />
      </div>
    </div>
  );
}
