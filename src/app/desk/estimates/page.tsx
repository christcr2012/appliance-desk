import type { Metadata } from "next";
import { requireRole } from "@/lib/session";
import {
  getQuoteCounts,
  getQuotes,
  type QuoteListRow,
} from "@/domains/estimates";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate, relativeBusinessDay } from "@/lib/business-date";
import {
  AutoRefresh,
  DataTable,
  EmptyState,
  Fab,
  PullToRefresh,
  ScreenHeader,
  StatusPill,
  StatusTabs,
  Toaster,
  Toolbar,
  type Column,
  type FilterDef,
  type MenuItem,
} from "@/components/kit";
import { parseQuotesParams, quotesHref } from "./params";

export const metadata: Metadata = { title: "Quotes" };

type Search = Record<string, string | string[] | undefined>;

// AR-4d (QUOTES-MESSAGES spec section 2): owner-side status words for the
// pill. estimateStatusLabel stays for customer-facing text.
const PILL: Record<QuoteListRow["status"], { label: string; tone: "neutral" | "info" | "attention" | "good" }> = {
  DRAFT: { label: "Draft", tone: "neutral" },
  SENT: { label: "Sent", tone: "info" },
  VIEWED: { label: "Viewed", tone: "info" },
  CHANGES_REQUESTED: { label: "Changes asked", tone: "attention" },
  APPROVED: { label: "Approved — make it a rental", tone: "attention" },
  CONVERTED: { label: "Became a rental", tone: "good" },
  DECLINED: { label: "Declined", tone: "neutral" },
  EXPIRED: { label: "Expired", tone: "neutral" },
};

function personName(row: QuoteListRow): string {
  if (row.customer) return row.customer.name ?? row.customer.company ?? "Customer";
  if (row.lead) return row.lead.contactName;
  return "No customer or lead linked";
}

function personCompany(row: QuoteListRow): string | null {
  if (row.customer) return row.customer.company;
  if (row.lead) return row.lead.company;
  return null;
}

function moneyLine(row: QuoteListRow): string {
  const monthly = `${formatMoney(row.monthlyCents)}/mo`;
  return row.oneTimeCents > 0 ? `${monthly} + ${formatMoney(row.oneTimeCents)} once` : monthly;
}

const DAY_MS = 86_400_000;

function detailLines(row: QuoteListRow, now: Date): { sent: string | null; expires: string | null } {
  let sent: string | null = null;
  if ((row.status === "SENT" || row.status === "VIEWED") && row.sentAt) {
    sent = `Sent ${relativeBusinessDay(row.sentAt, now)}`;
    if (row.viewedAt) sent += ` · viewed ${relativeBusinessDay(row.viewedAt, now)}`;
  }
  let expires: string | null = null;
  if (
    row.validUntil &&
    ["SENT", "VIEWED", "CHANGES_REQUESTED", "APPROVED"].includes(row.status) &&
    row.validUntil.getTime() <= now.getTime() + 3 * DAY_MS
  ) {
    expires = `Expires ${formatShortDate(row.validUntil, now)}`;
  }
  return { sent, expires };
}

function rowActions(row: QuoteListRow): MenuItem[] {
  const items: MenuItem[] = [];
  const href = `/desk/estimates/${row.id}`;
  if (row.status === "APPROVED") {
    items.push({ kind: "link", label: "Make it a rental", href: `${href}#convert`, primary: true });
  } else if (row.status === "DRAFT") {
    items.push({ kind: "link", label: "Finish and send", href, primary: true });
  } else if (row.status === "SENT" || row.status === "VIEWED") {
    if (row.contactPhone) {
      items.push({ kind: "tel", label: "Follow up", phone: row.contactPhone, primary: true });
    } else if (row.contactEmail) {
      items.push({ kind: "mailto", label: "Follow up", email: row.contactEmail, primary: true });
    }
  }
  items.push({ kind: "link", label: "Open", href });
  if (row.customer) {
    items.push({ kind: "link", label: "View customer", href: `/desk/customers/${row.customer.id}` });
  } else if (row.lead) {
    items.push({ kind: "link", label: "View lead", href: `/desk/leads/${row.lead.id}` });
  }
  return items;
}

/** Custom-priced quotes for deals that don't fit standard self-serve
 * pricing — a property manager ordering for several units, an entire
 * building, and similar (2026-09-29, see docs/DECISIONS.md). Always
 * OWNER/ADMIN: a quote is where custom pricing gets decided, same access
 * level as Billing/Settings. */
export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  await requireRole("OWNER", "ADMIN");
  const raw = await searchParams;
  const now = new Date();
  const params = parseQuotesParams(raw);
  const [list, counts] = await Promise.all([getQuotes(params), getQuoteCounts(params)]);

  const tab = params.tab ?? "open";
  const tabs = [
    { value: "open", label: "Open", count: counts.open },
    { value: "approved", label: "Approved", count: counts.approved, hideWhenZero: true },
    { value: "won", label: "Won" },
    { value: "closed", label: "Closed" },
    { value: "drafts", label: "Drafts", count: counts.drafts, hideWhenZero: true },
  ];

  const filters: FilterDef[] = [
    {
      kind: "select",
      param: "who",
      label: "For",
      options: [
        { value: "customers", label: "Customers" },
        { value: "leads", label: "Leads" },
      ],
    },
  ];

  const sorts = [
    { value: "newest", label: "Newest" },
    { value: "oldest-sent", label: "Waiting longest" },
    { value: "value-desc", label: "Biggest" },
    { value: "expires", label: "Expiring soonest" },
  ];

  const columns: Column<QuoteListRow>[] = [
    {
      key: "who",
      header: "Who",
      cell: (row) => {
        const company = personCompany(row);
        const sub = company ?? (row.lead ? "Lead" : null);
        return (
          <div>
            <span>{personName(row)}</span>
            {sub ? <span className="mt-0.5 block text-sm font-normal text-ink-soft">{sub}</span> : null}
          </div>
        );
      },
    },
    {
      key: "quote",
      header: "Quote",
      cell: (row) => `Quote #${row.estimateNumber} · ${row.title}`,
    },
    {
      key: "monthly",
      header: "Monthly",
      align: "right",
      cell: (row) => formatMoney(row.monthlyCents),
    },
    {
      key: "once",
      header: "Once",
      align: "right",
      cell: (row) => (row.oneTimeCents > 0 ? formatMoney(row.oneTimeCents) : "—"),
    },
    {
      key: "status",
      header: "Status",
      cell: (row) => {
        const pill = PILL[row.status];
        return <StatusPill label={pill.label} tone={pill.tone} />;
      },
    },
    {
      key: "sent",
      header: "Sent",
      cell: (row) => (row.sentAt ? relativeBusinessDay(row.sentAt, now) : "—"),
    },
  ];

  const filtered = Boolean(params.q || params.who);

  return (
    <PullToRefresh>
      <div className="px-1 sm:px-0">
        <ScreenHeader
          title="Quotes"
          list
          primary={{ kind: "link", label: "New quote", href: "/desk/estimates/new" }}
        />
        <AutoRefresh />
        <Toaster />
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <StatusTabs label="Quote status" param="status" current={tab} items={tabs} />
          <div className="min-w-0 flex-1">
            <Toolbar
              search={{ param: "q", placeholder: "Name or quote number", label: "Search quotes" }}
              filters={filters}
              sorts={sorts}
              currentSort={params.sort ?? "newest"}
            />
          </div>
        </div>
        <div className="mt-2">
          <DataTable
            caption="Quotes"
            rows={list.rows}
            rowKey={(row) => row.id}
            columns={columns}
            rowHref={(row) => `/desk/estimates/${row.id}`}
            mobileCardLink
            rowActions={rowActions}
            currentSort={params.sort ?? "newest"}
            mobileCard={(row) => {
              const pill = PILL[row.status];
              const { sent, expires } = detailLines(row, now);
              return (
                <div className="flex flex-col gap-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 font-bold text-ink">
                      {personName(row)}
                      {row.lead && !row.customer ? <StatusPill label="Lead" tone="neutral" /> : null}
                    </span>
                    <StatusPill label={pill.label} tone={pill.tone} />
                  </div>
                  <span className="text-sm text-ink-soft">
                    Quote #{row.estimateNumber} · {row.title}
                  </span>
                  <span className="flex items-center justify-between text-sm text-ink-soft">
                    <span>{sent ?? personCompany(row) ?? ""}</span>
                    <span className="font-semibold text-ink">{moneyLine(row)}</span>
                  </span>
                  {expires ? (
                    <span className="text-sm font-semibold text-warning-ink">{expires}</span>
                  ) : null}
                </div>
              );
            }}
            empty={
              filtered ? (
                <EmptyState
                  title="No quotes match"
                  action={{
                    kind: "link",
                    label: "Clear filters",
                    href: quotesHref(params, { q: undefined, who: undefined, cursor: undefined }),
                  }}
                />
              ) : tab === "open" ? (
                <EmptyState
                  title="No open quotes"
                  action={{ kind: "link", label: "New quote", href: "/desk/estimates/new" }}
                />
              ) : (
                <EmptyState title="No quotes here" />
              )
            }
            nextHref={list.nextCursor ? quotesHref(params, { cursor: list.nextCursor }) : null}
            capReached={list.capped}
          />
        </div>
        <Fab spec={{ kind: "link", label: "New quote", href: "/desk/estimates/new" }} />
      </div>
    </PullToRefresh>
  );
}
