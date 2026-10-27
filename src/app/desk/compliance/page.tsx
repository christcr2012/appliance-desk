import Link from "next/link";
import { EmptyState, StatusPill } from "@/components/kit";
import { requireRole } from "@/lib/session";
import { businessDateKey } from "@/lib/business-date";
import { OBLIGATIONS, notNeededObligations, obligationByKey, unscheduledObligations } from "@/domains/compliance/registry";
import { getComplianceProfile, missingFacts } from "@/domains/compliance/profile";
import {
  complianceContextForYear,
  groupFilingsForScreen,
  listComplianceFilings,
  syncComplianceFilings,
} from "@/domains/compliance/filings";
import type { ComplianceFiling } from "@prisma/client";

export const metadata = { title: "Compliance", robots: { index: false, follow: false } };

const TABS = [
  { key: "coming", label: "Coming up" },
  { key: "needs", label: "Needs you" },
  { key: "done", label: "Done" },
  { key: "notneeded", label: "Not needed" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const STATE_LABEL: Record<string, string> = {
  UPCOMING: "Coming up",
  READY_FOR_REVIEW: "Needs your review",
  APPROVED: "Approved",
  SUBMITTED: "Submitted",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  DONE_ELSEWHERE: "Done another way",
  NOT_APPLICABLE: "Not needed",
};

function stateTone(state: string): "neutral" | "good" | "attention" | "info" | "danger" {
  if (state === "READY_FOR_REVIEW") return "attention";
  if (state === "REJECTED") return "danger";
  if (state === "ACCEPTED") return "good";
  if (state === "APPROVED" || state === "SUBMITTED") return "info";
  return "neutral";
}

const fmtDay = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);

function FilingRow({ filing }: { filing: ComplianceFiling }) {
  const obligation = obligationByKey(filing.obligationKey);
  return (
    <li>
      <Link
        href={`/desk/compliance/${filing.id}`}
        className="flex flex-wrap items-center gap-3 rounded-card bg-surface px-4 py-3 hover:bg-tint"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-ink">
            {obligation?.title ?? filing.obligationKey}
          </span>
          <span className="block text-sm text-ink-soft">
            {filing.periodKey} · {obligation?.agency ?? ""}
          </span>
        </span>
        <span className="text-sm text-ink-soft">
          Do on {fmtDay(filing.actOn)} · due {fmtDay(filing.dueOn)}
        </span>
        <StatusPill label={STATE_LABEL[filing.state] ?? filing.state} tone={stateTone(filing.state)} />
      </Link>
    </li>
  );
}

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === params.tab) ? (params.tab as TabKey) : "coming";

  await syncComplianceFilings();
  const now = new Date();
  const horizon = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000);
  const [filings, profile] = await Promise.all([listComplianceFilings(), getComplianceProfile()]);
  const thisYear = Number(businessDateKey(now).slice(0, 4));
  const ctx = await complianceContextForYear(thisYear);
  const gaps = missingFacts(profile);

  const grouped = groupFilingsForScreen(filings, horizon);
  const coming = grouped.coming;
  const needsFilings = grouped.needs;
  const done = grouped.done;
  const notApplicable = grouped.notApplicable;
  const dormant = OBLIGATIONS.filter((o) => !o.applies(ctx).applies);
  const notNeeded = notNeededObligations(ctx);
  // Applies, but no honest dates yet — shown under "Needs you" with what
  // is missing, never silently dropped.
  const unscheduled = unscheduledObligations(ctx, [thisYear - 1, thisYear, thisYear + 1]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Compliance sections" className="flex flex-wrap gap-2">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={t.key === "coming" ? "/desk/compliance" : `/desk/compliance?tab=${t.key}`}
              aria-current={tab === t.key ? "page" : undefined}
              className={`rounded-lg border px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${
                tab === t.key
                  ? "border-action bg-action text-on-action"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              {t.label}
              {t.key === "needs" && needsFilings.length + gaps.length + unscheduled.length > 0
                ? ` (${needsFilings.length + gaps.length + unscheduled.length})`
                : ""}
            </Link>
          ))}
        </nav>
        <span className="flex-1" />
        <Link
          href="/desk/compliance/facts"
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Business facts
        </Link>
        <a
          href={"/desk/compliance/calendar"}
          className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium hover:bg-accent"
        >
          Calendar download (.ics)
        </a>
      </div>

      {tab === "coming" ? (
        coming.length ? (
          <ul className="space-y-2">
            {coming.map((f) => (
              <FilingRow key={f.id} filing={f} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing due in the next 120 days" />
        )
      ) : null}

      {tab === "needs" ? (
        <div className="space-y-4">
          {gaps.length ? (
            <ul className="space-y-2">
              {gaps.map((gap) => (
                <li key={gap.key}>
                  <Link
                    href="/desk/compliance/facts"
                    className="block rounded-card bg-surface px-4 py-3 hover:bg-tint"
                  >
                    <span className="block font-semibold text-ink">{gap.label}</span>
                    <span className="block text-sm text-ink-soft">{gap.why}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {needsFilings.length ? (
            <ul className="space-y-2">
              {needsFilings.map((f) => (
                <FilingRow key={f.id} filing={f} />
              ))}
            </ul>
          ) : null}
          {unscheduled.length ? (
            <div className="space-y-2">
              <h2 className="text-sm font-semibold text-ink">Applies to you, dates not set yet</h2>
              {unscheduled.map((entry) => (
                <div key={entry.key} className="rounded-card bg-surface px-4 py-3">
                  <p className="font-semibold text-ink">{entry.title}</p>
                  <p className="text-sm text-ink-soft">{entry.explain}</p>
                  <p className="text-sm text-ink-soft">{entry.reason}</p>
                  <p className="text-sm">
                    <a className="underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                      Source: {entry.agency}
                    </a>
                  </p>
                </div>
              ))}
            </div>
          ) : null}
          {!gaps.length && !needsFilings.length && !unscheduled.length ? (
            <EmptyState title="Nothing needs you right now" />
          ) : null}
        </div>
      ) : null}

      {tab === "done" ? (
        done.length ? (
          <ul className="space-y-2">
            {done.map((f) => (
              <FilingRow key={f.id} filing={f} />
            ))}
          </ul>
        ) : (
          <EmptyState title="Nothing filed yet" />
        )
      ) : null}

      {tab === "notneeded" ? (
        <div className="space-y-2">
          {notApplicable.map((f) => (
            <FilingRow key={f.id} filing={f} />
          ))}
          {dormant.map((o) => (
            <div key={o.key} className="rounded-card bg-surface px-4 py-3">
              <p className="font-semibold text-ink">{o.title}</p>
              <p className="text-sm text-ink-soft">{o.applies(ctx).why}</p>
              <p className="text-sm">
                <a className="underline" href={o.sourceUrl} target="_blank" rel="noreferrer">
                  Source: {o.agency}
                </a>
              </p>
            </div>
          ))}
          {notNeeded.map((entry) => (
            <div key={entry.key} className="rounded-card bg-surface px-4 py-3">
              <p className="font-semibold text-ink">{entry.title}</p>
              <p className="text-sm text-ink-soft">{entry.reason}</p>
              <p className="text-sm">
                <a className="underline" href={entry.sourceUrl} target="_blank" rel="noreferrer">
                  Source: {entry.agency}
                </a>
              </p>
            </div>
          ))}
          {!notApplicable.length && !dormant.length && !notNeeded.length ? (
            <EmptyState title="Everything on the list applies" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
