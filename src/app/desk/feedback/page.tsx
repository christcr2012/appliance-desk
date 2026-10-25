import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listFeedbackForTriage, TRIAGE_TAB_LABELS, TRIAGE_TABS, type TriageParams, type TriageTab } from "@/domains/feedback";
import { teamPill } from "@/domains/feedback/rules";
import { ButtonLink, PageHeader, StatusPill } from "@/components/ui";
import { firstParam } from "@/components/feedback/page-helpers";
import { relativeBusinessDay } from "@/components/feedback/views";

export const metadata = { title: "App feedback" };

const ROLE_WORDS: Record<string, string> = { OWNER: "Owner", ADMIN: "Admin", STAFF: "Staff", CUSTOMER: "Customer" };

type Query = { tab: TriageTab; kind: string; from: string; q: string; reporter: string };

function href(query: Query, change: Partial<Query>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.tab !== "new") params.set("tab", next.tab);
  if (next.kind) params.set("kind", next.kind);
  if (next.from) params.set("from", next.from);
  if (next.q) params.set("q", next.q);
  if (next.reporter) params.set("reporter", next.reporter);
  const text = params.toString();
  return text ? `/desk/feedback?${text}` : "/desk/feedback";
}

// MCP-10a triage: OWNER and ADMIN only (customers' reports can hold personal details). Staff never reach this list:
// requireRole refuses them here and the domain re-checks the role on every read.
export default async function FeedbackTriagePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireRole("OWNER", "ADMIN");
  const raw = await searchParams;
  const tab = (TRIAGE_TABS as readonly string[]).includes(firstParam(raw.tab) ?? "") ? (firstParam(raw.tab) as TriageTab) : "new";
  const kind = ["BUG", "IMPROVEMENT"].includes(firstParam(raw.kind) ?? "") ? firstParam(raw.kind)! : "";
  const from = ["customers", "team"].includes(firstParam(raw.from) ?? "") ? firstParam(raw.from)! : "";
  const q = (firstParam(raw.q) ?? "").slice(0, 160);
  const reporter = (firstParam(raw.reporter) ?? "").slice(0, 64);
  const query: Query = { tab, kind, from, q, reporter };
  const page = await listFeedbackForTriage({
    tab, kind: (kind || null) as TriageParams["kind"], from: (from || null) as TriageParams["from"], q, reporter,
    cursor: firstParam(raw.cursor),
  });

  return (
    <div className="max-w-5xl space-y-5">
      <PageHeader
        title="App feedback"
        secondaryActions={<ButtonLink variant="secondary" href="/desk/settings/feedback">Settings</ButtonLink>}
      />
      <nav aria-label="Report status" className="flex flex-wrap gap-2">
        {TRIAGE_TABS.map((key) => (
          <ButtonLink
            key={key}
            href={href(query, { tab: key })}
            variant={key === tab ? "primary" : "secondary"}
            aria-current={key === tab ? "page" : undefined}
          >
            {TRIAGE_TAB_LABELS[key]}{key === "new" || key === "answered" ? ` ${page.counts[key]}` : ""}
          </ButtonLink>
        ))}
      </nav>

      <form action="/desk/feedback" method="get" className="flex flex-wrap items-end gap-3">
        {tab !== "new" && <input type="hidden" name="tab" value={tab} />}
        <label className="block text-sm font-semibold text-ink">
          Kind
          <select name="kind" defaultValue={kind} className="mt-2 block min-h-11 rounded-control border border-control bg-surface px-3 text-ink">
            <option value="">Both</option>
            <option value="BUG">Something isn&apos;t working</option>
            <option value="IMPROVEMENT">Ideas</option>
          </select>
        </label>
        <label className="block text-sm font-semibold text-ink">
          From
          <select name="from" defaultValue={from} className="mt-2 block min-h-11 rounded-control border border-control bg-surface px-3 text-ink">
            <option value="">Everyone</option>
            <option value="customers">Customers</option>
            <option value="team">Team</option>
          </select>
        </label>
        <label className="block min-w-48 flex-1 text-sm font-semibold text-ink">
          Search title or #number
          <input name="q" defaultValue={q} maxLength={160} className="mt-2 block min-h-11 w-full rounded-control border border-control bg-surface px-3 text-ink" />
        </label>
        {reporter && <input type="hidden" name="reporter" value={reporter} />}
        <button type="submit" className="min-h-11 rounded-control bg-action px-4 text-sm font-semibold text-on-action">Show results</button>
        {(kind || from || q || reporter) && (
          <Link href={href(query, { kind: "", from: "", q: "", reporter: "" })} className="inline-flex min-h-11 items-center text-sm font-semibold underline">
            Clear all
          </Link>
        )}
      </form>

      {page.rows.length === 0 ? (
        <div className="rounded-card bg-subtle p-5 text-sm">
          <p className="font-medium text-ink">Nothing here right now.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {page.rows.map((row) => {
            const pill = teamPill(row.state, row.awaitingTeam);
            return (
              <li key={row.id}>
                <Link
                  href={`/desk/feedback/${encodeURIComponent(row.id)}`}
                  className="flex min-h-16 flex-col gap-2 rounded-card border border-line bg-surface p-4 hover:bg-subtle lg:flex-row lg:items-center lg:justify-between"
                >
                  <span className="min-w-0 break-words font-semibold text-ink">#{row.number} · {row.title}</span>
                  <span className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
                    <span>{row.reporterName}</span>
                    <span className="rounded-control border border-line px-2 py-0.5 text-xs font-semibold text-ink">{ROLE_WORDS[row.reporterRole]}</span>
                    <span>{row.kind === "BUG" ? "Problem" : "Idea"}</span>
                    <StatusPill tone={pill.tone} label={pill.label} />
                    <span>Updated {relativeBusinessDay(row.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {page.nextCursor && (
        <Link href={`${href(query, {})}${href(query, {}).includes("?") ? "&" : "?"}cursor=${encodeURIComponent(page.nextCursor)}`} className="inline-flex min-h-11 items-center font-semibold underline">
          Load more
        </Link>
      )}
      {page.atCap && <p className="text-sm text-ink-soft">Narrow your filters to see more</p>}
    </div>
  );
}
