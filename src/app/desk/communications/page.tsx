import type { Metadata } from "next";
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { getSmsInboxCounts, listSmsInbox, type InboxFilters } from "@/domains/messaging/inbox";
import { isLegacySmsDispatchEnabled } from "@/domains/messaging/sms-activation";
import { relativeBusinessDay } from "@/lib/business-date";
import {
  AutoRefresh,
  EmptyState,
  InfoTip,
  PullToRefresh,
  ScreenHeader,
  StatusPill,
  StatusTabs,
  Toaster,
  Toolbar,
  type FilterDef,
} from "@/components/kit";
import { MATCH_ENUM, STATUS_ENUM, messagesHref, parseMessagesParams } from "./params";

export const metadata: Metadata = { title: "Messages" };

type Search = Record<string, string | string[] | undefined>;

type InboxRow = Awaited<ReturnType<typeof listSmsInbox>>["rows"][number];

// AR-4d (QUOTES-MESSAGES spec section 3): plain words for the stored codes.
function statusPill(row: InboxRow): { label: string; tone: "attention" | "info" | "neutral" | "good" } {
  if (row.status === "OPEN") {
    return { label: "Needs a reply", tone: row.unread ? "attention" : "info" };
  }
  if (row.status === "WAITING") return { label: "Waiting on them", tone: "neutral" };
  return { label: "Done", tone: "good" };
}

function matchPill(row: InboxRow): { label: string; tone: "attention" } | null {
  if (row.resolution === "UNRESOLVED") return { label: "Unknown number", tone: "attention" };
  if (row.resolution === "AMBIGUOUS") return { label: "Matches more than one person", tone: "attention" };
  return null;
}

const EMPTY_FOR_TAB: Record<string, string> = {
  open: "Nothing needs a reply",
  waiting: "Nothing waiting",
  done: "No finished conversations",
};

export default async function CommunicationsInbox({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const session = await requireRole("OWNER", "ADMIN", "STAFF");
  const raw = await searchParams;
  const now = new Date();
  const params = parseMessagesParams(raw);
  const filters: InboxFilters = {
    status: STATUS_ENUM[params.status],
    resolution: params.match ? MATCH_ENUM[params.match] : undefined,
    assignment: params.who,
  };
  const [page, counts, smsLive] = await Promise.all([
    listSmsInbox(session.user.id, filters, params.cursor),
    getSmsInboxCounts(session.user.id, {
      resolution: filters.resolution,
      assignment: params.who,
    }),
    isLegacySmsDispatchEnabled(),
  ]);

  const tabs = [
    { value: "open", label: "Needs a reply", count: counts.open },
    { value: "waiting", label: "Waiting", count: counts.waiting },
    { value: "done", label: "Done" },
  ];

  const filterDefs: FilterDef[] = [
    {
      kind: "select",
      param: "who",
      label: "Who",
      options: [
        { value: "mine", label: "Mine" },
        { value: "unassigned", label: "Unassigned" },
      ],
    },
    {
      kind: "select",
      param: "match",
      label: "Number",
      options: [
        { value: "known", label: "Known" },
        { value: "unknown", label: "Unknown" },
        { value: "several", label: "Several" },
      ],
    },
  ];

  const filtered = Boolean(params.match || params.who !== "all");

  return (
    <PullToRefresh>
      <div className="px-1 sm:px-0">
        <ScreenHeader
          title="Messages"
          list
          overflow={[
            { kind: "link", label: "Calls & voicemail", href: "/desk/communications/calls" },
          ]}
        />
        <AutoRefresh />
        <Toaster />
        {!smsLive ? (
          <p className="mb-3 flex items-center gap-1.5 text-sm text-ink-soft">
            Texting with customers isn&apos;t turned on yet.
            <InfoTip term="texting-switch" />
          </p>
        ) : null}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-4">
          <StatusTabs label="Conversation status" param="status" current={params.status} items={tabs} />
          <div className="min-w-0 flex-1">
            <Toolbar filters={filterDefs} />
          </div>
        </div>
        <div className="mt-2">
          {page.rows.length === 0 ? (
            filtered ? (
              <EmptyState
                title="No conversations match"
                action={{
                  kind: "link",
                  label: "Clear filters",
                  href: messagesHref(params, { match: undefined, who: "all", cursor: undefined }),
                }}
              />
            ) : (
              <EmptyState title={EMPTY_FOR_TAB[params.status]} />
            )
          ) : (
            <ul
              aria-label="Messages"
              className="divide-y divide-line rounded-card border border-line bg-surface"
            >
              {page.rows.map((row) => {
                const pill = statusPill(row);
                const match = matchPill(row);
                const name = row.customerName ?? row.leadName ?? "Unknown number";
                const threadHref = `/desk/communications/${encodeURIComponent(row.id)}`;
                return (
                  <li key={row.id} className="px-4 py-3">
                    <Link href={threadHref} className="block text-ink">
                      <span className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 font-bold">
                          {row.unread ? (
                            <span className="h-2 w-2 shrink-0 rounded-full bg-primary">
                              <span className="sr-only">Unread</span>
                            </span>
                          ) : null}
                          {name}
                        </span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          {match ? <StatusPill label={match.label} tone={match.tone} /> : null}
                          <StatusPill label={pill.label} tone={pill.tone} />
                        </span>
                      </span>
                      <span className="mt-0.5 block text-sm text-ink-soft">
                        {relativeBusinessDay(row.lastActivityAt, now)} ·{" "}
                        {row.assignedName ?? "Unassigned"}
                      </span>
                    </Link>
                    {match ? (
                      <Link
                        href={threadHref}
                        className="mt-1 inline-block text-sm font-semibold text-ink underline-offset-4 hover:underline"
                      >
                        Link to a person…
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          {page.next ? (
            <p className="py-4 text-center">
              <Link
                href={messagesHref(params, { cursor: page.next })}
                className="text-sm font-semibold text-ink underline-offset-4 hover:underline"
              >
                Older conversations
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </PullToRefresh>
  );
}
