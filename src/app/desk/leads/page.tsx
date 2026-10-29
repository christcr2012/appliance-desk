import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireRole } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  getLeadQueue,
  getLeadStageCounts,
  type LeadRow,
} from "@/domains/leads/queue";
import type { LeadStage } from "@/domains/leads/stage";
import { getLeadNotes } from "@/domains/leads";
import { assignableLeadOwners } from "@/domains/leads/assignment";
import { defaultFollowUpKey, getLeadResponseDays } from "@/domains/leads/follow-up";
import { leadNextStep } from "@/domains/leads/next-step";
import { businessDateKey, formatShortDate } from "@/lib/business-date";
import {
  AutoRefresh,
  DataTable,
  EmptyState,
  InfoTip,
  PullToRefresh,
  ScreenHeader,
  SidePanel,
  StatusPill,
  StatusTabs,
  Toaster,
  Toolbar,
  type Column,
  type FilterDef,
  type MenuItem,
} from "@/components/kit";
import { builtInViewsFor } from "@/components/kit/built-in-views";
import { leadsHref, parseLeadsParams, type LeadsPageParams } from "./params";
import { BulkLeadSheets, LeadRowSheets, type BulkKind, type SheetKind } from "./lead-row-sheets";
import { LeadsBoard, type BoardColumn } from "./leads-board";

export const metadata: Metadata = { title: "Leads" };

type Search = Record<string, string | string[] | undefined>;

const STAGE_WORDS: Record<LeadStage, string> = {
  new: "New",
  contacted: "Contacted",
  quoted: "Quote sent",
  won: "Won",
  lost: "Lost",
};

const STAGE_TONES: Record<LeadStage, "info" | "neutral" | "good"> = {
  new: "info",
  contacted: "neutral",
  quoted: "info",
  won: "good",
  lost: "neutral",
};

const TERM_WORDS: Record<string, string> = {
  "month-to-month": "Month to month",
  "6-month": "6 months",
  "12-month": "12 months",
};

const SORTS = [
  { value: "next-up", label: "Next up" },
  { value: "newest", label: "Newest" },
  { value: "score", label: "Highest score" },
  { value: "value", label: "Biggest monthly value" },
  { value: "activity", label: "Last activity" },
];

const SHEETS: SheetKind[] = ["followup", "assign", "log", "lost", "convert"];

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const role = session.user.role as "OWNER" | "ADMIN" | "STAFF";
  const raw = await searchParams;
  const params = parseLeadsParams(raw);
  const now = new Date();

  const resolved: LeadsPageParams = {
    ...params,
    ...(params.owner === "me" ? { owner: session.user.id } : {}),
  };
  const counts = await getLeadStageCounts({
    q: resolved.q,
    owner: resolved.owner,
    source: resolved.source,
    area: resolved.area,
    highValue: resolved.highValue,
    appliance: resolved.appliance,
    created: resolved.created,
    hasQuote: resolved.hasQuote,
    follow: resolved.follow,
    pm: resolved.pm,
  });
  // The count-based default stage (LEADS.md section 2): New when it has
  // leads, else Contacted — never when `follow` is set (no stage filter).
  const stage: LeadStage | undefined =
    params.stage ?? (params.follow ? undefined : counts.new > 0 ? "new" : "contacted");

  const [list, sources, owners, applianceTypes, responseDays] = await Promise.all([
    getLeadQueue({ ...resolved, stage, sort: params.sort, cursor: params.cursor }, now),
    prisma.lead.findMany({
      where: { mergedIntoLeadId: null, howHeard: { not: null } },
      distinct: ["howHeard"],
      select: { howHeard: true },
      orderBy: { howHeard: "asc" },
    }),
    prisma.$transaction((tx) => assignableLeadOwners(tx)),
    prisma.applianceType.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    getLeadResponseDays(),
  ]);
  const rows = list.rows;

  // Board view (?layout=board): the three open stages side by side, same
  // filters, next-up order. Fetched only in board mode.
  const boardMode = raw.layout === "board";
  const boardColumns: BoardColumn[] = [];
  let boardRows: LeadRow[] = [];
  if (boardMode) {
    const stages = [
      ["new", "New"],
      ["contacted", "Contacted"],
      ["quoted", "Quote sent"],
    ] as const;
    for (const [boardStage, label] of stages) {
      const q = await getLeadQueue({ ...resolved, stage: boardStage, sort: "next-up", cursor: undefined }, now);
      boardRows = [...boardRows, ...q.rows];
      boardColumns.push({
        stage: boardStage,
        label,
        cards: q.rows.map((r) => ({
          id: r.id,
          contactName: r.contactName,
          line: [r.city, r.applianceSummary].filter(Boolean).join(" · "),
          nextStep: leadNextStep({ ...r, responseDays }, now).text,
          score: r.score,
        })),
      });
    }
  }
  const sheetRows = boardMode ? boardRows : rows;

  // Which listed leads have a granted texting consent on file (the "Send a
  // text…" menu item shows only for those; the record page's text panel
  // still runs the full eligibility check before anything sends).
  const consented = new Set(
    (
      await prisma.consentRecord.findMany({
        where: { leadId: { in: rows.map((r) => r.id) }, action: "GRANT" },
        select: { leadId: true },
      })
    ).map((c) => c.leadId),
  );

  const tabs = [
    { value: "new", label: "New", count: counts.new },
    { value: "contacted", label: "Contacted", count: counts.contacted },
    { value: "quoted", label: "Quote sent", count: counts.quoted },
    { value: "won", label: "Won" },
    { value: "lost", label: "Lost" },
  ];

  const filters: FilterDef[] = [
    {
      kind: "select",
      param: "owner",
      label: "Owner",
      options: [
        { value: "me", label: "Me" },
        { value: "unassigned", label: "Unassigned" },
        ...owners.map((o) => ({ value: o.id, label: o.name })),
      ],
    },
    {
      kind: "multi",
      param: "source",
      label: "How they heard",
      options: sources
        .map((s) => s.howHeard)
        .filter((s): s is string => Boolean(s))
        .map((s) => ({ value: s, label: s })),
    },
    {
      kind: "select",
      param: "area",
      label: "Service area",
      options: [
        { value: "in", label: "In area" },
        { value: "out", label: "Out of area" },
      ],
    },
    { kind: "toggle", param: "high", label: "High value" },
    {
      kind: "multi",
      param: "appliance",
      label: "Appliances",
      options: applianceTypes.map((a) => ({ value: a.id, label: a.name })),
    },
    {
      kind: "select",
      param: "created",
      label: "Created",
      options: [
        { value: "today", label: "Today" },
        { value: "week", label: "This week" },
        { value: "month", label: "This month" },
      ],
    },
    { kind: "toggle", param: "quote", label: "Has a quote" },
  ];

  const filtered = Boolean(
    params.q || params.owner || params.source?.length || params.area || params.highValue ||
      params.appliance?.length || params.created || params.hasQuote || params.follow || params.pm,
  );

  const sheetHref = (row: LeadRow, sheet: SheetKind) =>
    leadsHref({ ...params, stage }, { sheet, lead: row.id, cursor: null, open: null });

  const rowActions = (row: LeadRow): MenuItem[] => {
    const items: MenuItem[] = [
      { kind: "link", label: "Open", href: `/desk/leads/${row.id}` },
    ];
    if (row.status === "CONTACTED") {
      items.push({ kind: "link", label: "Set follow-up…", href: sheetHref(row, "followup") });
    }
    items.push({ kind: "link", label: "Assign to…", href: sheetHref(row, "assign") });
    items.push({ kind: "link", label: "Log a contact…", href: sheetHref(row, "log") });
    if (row.stage !== "won" && row.stage !== "lost") {
      items.push({ kind: "link", label: "Mark lost…", href: sheetHref(row, "lost") });
      items.push({ kind: "link", label: "Convert to customer", href: sheetHref(row, "convert") });
    }
    if (consented.has(row.id)) {
      items.push({ kind: "link", label: "Send a text…", href: `/desk/leads/${row.id}` });
    }
    return items;
  };

  const nextStep = (row: LeadRow) => leadNextStep({ ...row, responseDays }, now);

  const columns: Column<LeadRow>[] = [
    { key: "name", header: "Name", cell: (row) => row.contactName },
    {
      key: "wants",
      header: "Wants",
      cell: (row) => row.applianceSummary,
      desktopOnly: true,
    },
    {
      key: "stage",
      header: "Stage",
      cell: (row) => <StatusPill label={STAGE_WORDS[row.stage]} tone={STAGE_TONES[row.stage]} />,
    },
    {
      key: "score",
      header: "Score",
      align: "right",
      cell: (row) => row.score,
      sortValue: "score",
    },
    { key: "next", header: "Next step", cell: (row) => nextStep(row).text },
    {
      key: "owner",
      header: "Owner",
      cell: (row) => row.assignedTo?.name ?? "Unassigned",
      desktopOnly: true,
    },
    {
      key: "created",
      header: "Created",
      cell: (row) => formatShortDate(row.createdAt, now),
      sortValue: "newest",
    },
  ];

  // Side panel: the opened lead's header, next step and recent activity.
  const openId = typeof raw.open === "string" ? raw.open : undefined;
  const openRow = openId ? rows.find((r) => r.id === openId) : undefined;
  const openNotes = openRow ? (await getLeadNotes(openRow.id)).slice(0, 5) : [];

  // The sheet named in the URL, for a lead in the current list.
  const sheetParam = typeof raw.sheet === "string" ? raw.sheet : undefined;
  const sheetLead =
    sheetParam && SHEETS.includes(sheetParam as SheetKind) && typeof raw.lead === "string"
      ? sheetRows.find((r) => r.id === raw.lead)
      : undefined;

  // The kit bulk bar posts the checked ids here; each staging action lands
  // on the matching bulk sheet (?bulk=…&ids=…), which runs bulkLeadAction.
  const stageBulk = (kind: BulkKind) => async (fd: FormData) => {
    "use server";
    const ids = fd.getAll("id").map(String).filter(Boolean);
    redirect(leadsHref({ ...params, stage }, { bulk: kind, ids: ids.join(",") }));
  };
  const exportSelected = async (fd: FormData) => {
    "use server";
    const ids = fd.getAll("id").map(String).filter(Boolean);
    redirect(`/desk/leads/export?ids=${encodeURIComponent(ids.join(","))}`);
  };
  const bulkKind = typeof raw.bulk === "string" ? (raw.bulk as BulkKind) : undefined;
  const bulkIds =
    typeof raw.ids === "string" ? raw.ids.split(",").map((s) => s.trim()).filter(Boolean) : [];

  const exportHref = `/desk/leads/export${leadsHref({ ...params, stage }).slice("/desk/leads".length)}`;

  return (
    <PullToRefresh>
      <div className="flex items-start">
        <div className="min-w-0 flex-1 px-1 sm:px-0">
          <ScreenHeader
            title="Customers"
            list
            primary={{ kind: "link", label: "Add lead", href: "/desk/leads/new", primary: true }}
            overflow={[
              { kind: "link", label: "Export leads (CSV)", href: exportHref },
              { kind: "link", label: "Lead settings", href: "/desk/settings/lead-response" },
            ]}
          />
          <AutoRefresh />
          <Toaster />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
            <StatusTabs label="Lead stage" param="stage" current={stage ?? ""} items={tabs} />
            <div className="min-w-0 flex-1">
              <Toolbar
                search={{
                  param: "q",
                  placeholder: "Name, phone, email or city",
                  label: "Search leads",
                }}
                filters={filters}
                sorts={SORTS}
                currentSort={params.sort}
                views={builtInViewsFor("leads", { role })}
              />
            </div>
          </div>
          <div className="mt-1 hidden justify-end gap-1 lg:flex">
            <Link
              href={leadsHref({ ...params, stage }, { layout: null })}
              className={`rounded-field px-3 py-1.5 text-sm font-semibold ${boardMode ? "text-ink-soft" : "bg-tint text-ink"}`}
            >
              List
            </Link>
            <Link
              href={leadsHref({ ...params, stage }, { layout: "board" })}
              className={`rounded-field px-3 py-1.5 text-sm font-semibold ${boardMode ? "bg-tint text-ink" : "text-ink-soft"}`}
            >
              Board
            </Link>
          </div>
          {boardMode ? (
            <LeadsBoard
              columns={boardColumns}
              lostHref={(id) =>
                leadsHref({ ...params, stage }, { sheet: "lost", lead: id, layout: "board" })
              }
            />
          ) : (
          <div className="mt-2">
            <DataTable
              caption="Leads"
              rows={rows}
              rowKey={(row) => row.id}
              columns={columns}
              rowHref={(row) => `/desk/leads/${row.id}`}
              mobileCardLink={false}
              rowActions={rowActions}
              bulkActions={[
                { label: "Assign to…", action: stageBulk("assign") },
                { label: "Set follow-up…", action: stageBulk("follow-up") },
                { label: "Mark lost…", action: stageBulk("lost") },
                { label: "Export selected (CSV)", action: exportSelected },
              ]}
              selectedKey={openId}
              currentSort={params.sort}
              mobileCard={(row) => {
                const step = nextStep(row);
                return (
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <Link
                        href={`/desk/leads/${row.id}`}
                        className="font-bold text-ink underline-offset-4 hover:underline"
                      >
                        {row.contactName}
                      </Link>
                      <span className="flex items-center gap-1.5">
                        <StatusPill label={STAGE_WORDS[row.stage]} tone={STAGE_TONES[row.stage]} />
                        <span className="inline-flex items-center gap-1 text-sm font-semibold text-ink">
                          {row.score}
                          <InfoTip term="lead-score" />
                        </span>
                      </span>
                    </div>
                    {row.companyName ? (
                      <span className="text-sm text-ink-soft">{row.companyName}</span>
                    ) : null}
                    <span className="text-sm text-ink-soft">
                      {[row.city, row.applianceSummary, row.desiredTerm ? TERM_WORDS[row.desiredTerm] : null]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm ${step.tone === "attention" ? "font-semibold text-danger" : "text-ink-soft"}`}
                      >
                        {step.text}
                      </span>
                      <span className="flex items-center gap-2">
                        {row.isPropertyManager ? (
                          <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-ink">
                            Property manager
                          </span>
                        ) : null}
                        {row.isHighValue ? (
                          <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-ink">
                            High value
                          </span>
                        ) : null}
                        {row.assignedTo ? (
                          <span
                            title={row.assignedTo.name}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-on-primary"
                          >
                            {row.assignedTo.initials}
                          </span>
                        ) : (
                          <span
                            title="Unassigned"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-line text-xs text-ink-soft"
                          >
                            ?
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="mt-1 flex gap-2">
                      <a
                        href={`tel:${row.phone}`}
                        className={`inline-flex min-h-10 items-center rounded-field px-3 text-sm font-bold ${
                          row.stage === "new" || step.tone === "attention"
                            ? "bg-primary text-on-primary"
                            : "bg-tint text-ink"
                        }`}
                      >
                        Call
                      </a>
                      {row.email ? (
                        <a
                          href={`mailto:${row.email}`}
                          className="inline-flex min-h-10 items-center rounded-field bg-tint px-3 text-sm font-bold text-ink"
                        >
                          Email
                        </a>
                      ) : null}
                    </span>
                  </div>
                );
              }}
              empty={
                filtered ? (
                  <EmptyState
                    title="No leads match"
                    action={{ kind: "link", label: "Clear filters", href: "/desk/leads" }}
                  />
                ) : stage === "new" ? (
                  <EmptyState
                    title="No new leads waiting."
                    action={{ kind: "link", label: "Add lead", href: "/desk/leads/new" }}
                  />
                ) : (
                  <EmptyState title="No leads here" />
                )
              }
              nextHref={list.nextCursor ? leadsHref({ ...params, stage }, { cursor: list.nextCursor }) : null}
              capReached={list.capped}
            />
          </div>
          )}
        </div>
        {openRow ? (
          <SidePanel
            title={openRow.contactName}
            closeHref={leadsHref({ ...params, stage }, { open: null })}
            fullHref={`/desk/leads/${openRow.id}`}
          >
            <div className="flex flex-col gap-3">
              <span className="flex items-center gap-2">
                <StatusPill label={STAGE_WORDS[openRow.stage]} tone={STAGE_TONES[openRow.stage]} />
                {openRow.isHighValue ? (
                  <span className="rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-ink">
                    High value
                  </span>
                ) : null}
              </span>
              <p className="text-sm text-ink-soft">
                {[openRow.city, openRow.applianceSummary].filter(Boolean).join(" · ")}
              </p>
              <p className="text-[15px] font-semibold text-ink">{nextStep(openRow).text}</p>
              <p className="text-sm text-ink-soft">
                Owner: {openRow.assignedTo?.name ?? "Unassigned"} · Score {openRow.score}
              </p>
              {openNotes.length > 0 ? (
                <div>
                  <h3 className="text-sm font-semibold text-ink">Recent activity</h3>
                  <ul className="mt-1 space-y-2">
                    {openNotes.map((n) => (
                      <li key={n.id} className="text-sm text-ink-soft">
                        <span className="font-medium text-ink">
                          {formatShortDate(n.createdAt, now)}
                        </span>{" "}
                        {n.body}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          </SidePanel>
        ) : null}
      </div>
      {bulkKind && bulkIds.length > 0 ? (
        <BulkLeadSheets
          kind={bulkKind}
          ids={bulkIds}
          owners={owners}
          defaultFollowUpKey={defaultFollowUpKey(now)}
          closeHref={leadsHref({ ...params, stage }, { bulk: null, ids: null })}
        />
      ) : null}
      {sheetLead && sheetParam ? (
        <LeadRowSheets
          lead={{
            id: sheetLead.id,
            contactName: sheetLead.contactName,
            stage: sheetLead.stage,
            version: sheetLead.version,
            nextFollowUpKey: sheetLead.nextFollowUpOn ? businessDateKey(sheetLead.nextFollowUpOn) : null,
          }}
          sheet={sheetParam as SheetKind}
          owners={owners}
          defaultFollowUpKey={defaultFollowUpKey(now)}
          closeHref={leadsHref({ ...params, stage }, { sheet: null, lead: null })}
        />
      ) : null}
    </PullToRefresh>
  );
}
