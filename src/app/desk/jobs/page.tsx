import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { getVisitCounts, getVisits, type VisitListParams, type VisitRow } from "@/domains/jobs/visits-list";
import { parseVisitsParams } from "./params";
import { visitPill, visitTitle, visitWhen } from "@/domains/jobs/words";
import { getAssignableTeamMembers } from "@/domains/staff";
import { EmptyState } from "@/components/kit";
import {
  DataTable,
  InfoTip,
  ScreenHeader,
  StatusPill,
  StatusTabs,
  Toolbar,
  type Column,
  type FilterDef,
} from "@/components/kit";
import { builtInViewsFor } from "@/components/kit/built-in-views";

export const metadata = { title: "Visits" };

const TYPE_OPTIONS = [
  { value: "delivery", label: "Delivery" },
  { value: "pickup", label: "Pickup" },
  { value: "repair", label: "Repair" },
  { value: "swap", label: "Swap" },
  { value: "installation", label: "Installation" },
];

const WHEN_OPTIONS = [
  { value: "this-week", label: "This week" },
  { value: "next-week", label: "Next week" },
  { value: "last-30", label: "Last 30 days" },
];

const EMPTY_BY_TAB: Record<VisitListParams["tab"], string> = {
  upcoming: "Nothing coming up.",
  "no-time": "Everything has a time.",
  done: "No finished visits yet.",
  cancelled: "No cancelled visits.",
};

function visitsHref(params: VisitListParams, extra?: { cursor?: string }): string {
  const search = new URLSearchParams();
  search.set("status", params.tab);
  if (params.type) {
    const typeParam = Object.entries({
      DELIVERY: "delivery",
      REMOVAL: "pickup",
      MAINTENANCE_VISIT: "repair",
      SWAP: "swap",
      INSTALLATION: "installation",
    }).find(([key]) => key === params.type)?.[1];
    if (typeParam) search.set("type", typeParam);
  }
  if (params.who) search.set("who", params.who);
  if (params.q) search.set("q", params.q);
  if (params.when) search.set("when", params.when);
  search.set("sort", params.sort);
  if (extra?.cursor) search.set("cursor", extra.cursor);
  return `/desk/jobs?${search.toString()}`;
}

function applianceLine(row: VisitRow): string {
  const first = row.appliances[0]?.appliance;
  if (!first) return "—";
  const extra = row.appliances.length > 1 ? ` +${row.appliances.length - 1} more` : "";
  return `${first.applianceType.name} #${first.assetNumber}${extra}`;
}

function personCell(row: VisitRow) {
  if (row.assignedTo) return row.assignedTo.name ?? row.assignedTo.email;
  return (
    <span className="inline-flex items-center gap-1">
      Not assigned
      <InfoTip term="unassigned-visit" />
    </span>
  );
}

export default async function VisitsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = session.user.role;
  const ownerOrAdmin = role === "OWNER" || role === "ADMIN";
  const raw = await searchParams;
  // The kit table's row click sets ?open=<id> (its side-panel convention). Visits have no side
  // panel — the record page IS the destination — so an ?open= link goes straight there.
  const open = typeof raw.open === "string" ? raw.open : undefined;
  if (open) redirect(`/desk/jobs/${encodeURIComponent(open)}`);

  const params = parseVisitsParams(raw);
  const now = new Date();
  const [list, counts, members] = await Promise.all([
    getVisits(params, now),
    getVisitCounts(params, now),
    ownerOrAdmin ? getAssignableTeamMembers() : Promise.resolve([]),
  ]);

  const filters: FilterDef[] = [
    { kind: "select", param: "type", label: "Visit type", options: TYPE_OPTIONS },
    ...(ownerOrAdmin
      ? [
          {
            kind: "select",
            param: "who",
            label: "Person",
            options: [
              { value: "everyone", label: "Everyone" },
              { value: "mine", label: "Mine" },
              { value: "unassigned", label: "Not assigned" },
              ...members.map((m) => ({ value: m.id, label: m.name ?? m.email })),
            ],
          } as FilterDef,
        ]
      : []),
    { kind: "select", param: "when", label: "When", options: WHEN_OPTIONS },
  ];

  const sorts = [
    { value: "soonest", label: "Soonest first" },
    { value: "latest", label: "Latest first" },
  ];

  const views = [
    { id: "all", label: "All visits", href: "/desk/jobs?status=upcoming", builtIn: true },
    ...builtInViewsFor("jobs", {
      role: role === "OWNER" || role === "ADMIN" || role === "STAFF" ? role : undefined,
    }),
  ];

  const filtered = Boolean(params.q || params.type || params.who || params.when);

  const columns: Column<VisitRow>[] = [
    { key: "when", header: "When", cell: (row) => visitWhen(row, now) },
    {
      key: "visit",
      header: "Visit",
      cell: (row) => {
        const pill = visitPill(row);
        return (
          <div>
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-ink">{visitTitle(row)}</span>
              <StatusPill label={pill.label} tone={pill.tone} />
            </span>
            <span className="mt-1 block text-sm font-normal text-ink-soft">
              {row.serviceAddress
                ? `${row.serviceAddress.line1}, ${row.serviceAddress.city}`
                : "No address on file"}
            </span>
          </div>
        );
      },
    },
    { key: "person", header: "Person", cell: (row) => personCell(row) },
    { key: "appliances", header: "Appliances", cell: (row) => applianceLine(row) },
  ];

  return (
    <div>
      <ScreenHeader
        title="Visits"
        list
        primary={
          ownerOrAdmin
            ? { kind: "link", label: "Schedule a visit", href: "/desk/jobs/new" }
            : undefined
        }
      />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        Every visit on the schedule — deliveries, pickups, repairs and swaps.
      </p>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
        <StatusTabs
          label="Filter visits by status"
          param="status"
          current={params.tab}
          items={[
            { value: "upcoming", label: "Upcoming", count: counts.upcoming },
            { value: "no-time", label: "Needs a time", count: counts["no-time"], hideWhenZero: true },
            { value: "done", label: "Done", count: counts.done },
            { value: "cancelled", label: "Cancelled", count: counts.cancelled },
          ]}
        />
        <div className="min-w-0 flex-1">
          <Toolbar
            search={{
              param: "q",
              placeholder: "Customer, address or appliance number",
              label: "Search visits",
            }}
            filters={filters}
            sorts={sorts}
            currentSort={params.sort}
            views={views}
          />
        </div>
      </div>

      <div className="mt-2">
        <DataTable
          rows={list.rows}
          rowKey={(row) => row.id}
          columns={columns}
          caption="Visits"
          rowHref={(row) => `/desk/jobs/${row.id}`}
          mobileCard={(row) => {
            const pill = visitPill(row);
            return (
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-ink">{visitTitle(row)}</span>
                  <StatusPill label={pill.label} tone={pill.tone} />
                </div>
                <span className="text-sm text-ink-soft">{visitWhen(row, now)}</span>
                <span className="text-sm text-ink-soft">
                  {row.serviceAddress
                    ? `${row.serviceAddress.line1}, ${row.serviceAddress.city}`
                    : "No address on file"}
                </span>
                <span className="flex items-center justify-between text-sm text-ink-soft">
                  <span>{row.assignedTo ? (row.assignedTo.name ?? row.assignedTo.email) : "Not assigned"}</span>
                  <span>{applianceLine(row)}</span>
                </span>
              </div>
            );
          }}
          empty={
            filtered ? (
              <EmptyState
                title="No visits match."
                action={{ kind: "link", label: "Clear filters", href: `/desk/jobs?status=${params.tab}` }}
              />
            ) : (
              <EmptyState title={EMPTY_BY_TAB[params.tab]} />
            )
          }
          nextHref={list.nextCursor ? visitsHref(params, { cursor: list.nextCursor }) : null}
          capReached={list.capped}
        />
      </div>
    </div>
  );
}
