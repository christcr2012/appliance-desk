import Link from "next/link";
import { formatCents } from "@/domains/pricing/money";
import type { ExceptionItem } from "@/domains/exceptions";

export type AttentionGroup = {
  category: string;
  title: string;
  total: number;
  items: ExceptionItem[];
};

/** The word shown beside an item's stripe, from the item's existing severity. Never colour alone. */
export function severityWord(severity: ExceptionItem["severity"]): "Urgent" | "Soon" {
  return severity === "high" ? "Urgent" : "Soon";
}

export function AttentionList({
  groups,
  acknowledgeTaxSourceAction,
  undoOfficialRateAction,
  applyOfficialRateAction,
  snoozeAction,
  unsnoozeAction,
}: {
  groups: AttentionGroup[];
  acknowledgeTaxSourceAction?: (formData: FormData) => Promise<void>;
  undoOfficialRateAction?: (formData: FormData) => Promise<void>;
  applyOfficialRateAction?: (formData: FormData) => Promise<void>;
  snoozeAction?: (formData: FormData) => Promise<void>;
  unsnoozeAction?: (formData: FormData) => Promise<void>;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-ink-soft">
        Nothing needs attention right now.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const more = Math.max(0, group.total - group.items.length);
        const headingId = `attention-${group.category}`;

        return (
          <section key={group.category} aria-labelledby={headingId}>
            <div className="flex items-baseline justify-between gap-3">
              <h3 id={headingId} className="font-semibold text-ink">
                {group.title}
              </h3>
              <span className="text-sm tabular-nums text-ink-soft">
                {group.total}
              </span>
            </div>
            <ul className="mt-2 divide-y divide-line">
              {group.items.map((item) => (
                <li
                  key={`${item.category}:${item.title}:${item.href}:${item.since.toISOString()}`}
                  className={`border-l-4 py-3 pl-4 ${item.severity === "high" ? "border-danger" : "border-warning-ink"}`}
                >
                  <Link
                    href={item.href}
                    className="block min-h-11 hover:bg-subtle"
                  >
                    <span className={`block text-eyebrow uppercase ${item.severity === "high" ? "text-danger" : "text-warning-ink"}`}>
                      {severityWord(item.severity)}
                    </span>
                    <span className="font-medium text-ink">{item.title}</span>
                    <span className="mt-1 block text-sm text-ink-soft">
                      {item.detail}
                    </span>
                    {item.amountCents !== undefined ? <span className="mt-1 block text-sm font-semibold text-ink">Amount owed: {formatCents(item.amountCents)}</span> : null}
                    {item.dueLabel ? <span className="mt-1 block text-sm text-ink-soft">{item.dueLabel}</span> : null}
                  </Link>
                  {item.snooze ? <p className="text-sm text-ink-soft">Snoozed until {item.snooze.until.toISOString().slice(0, 10)} by {item.snooze.actorName}: {item.snooze.reason}</p> : null}
                  {item.snoozeHistory?.length ? (
                    <details className="mt-2 text-sm text-ink-soft">
                      <summary className="min-h-11 cursor-pointer">Snooze history ({item.snoozeHistory.length})</summary>
                      <ul className="list-disc space-y-1 pl-5">
                        {item.snoozeHistory.map((entry, index) => (
                          <li key={index}>{entry.at.toISOString().slice(0, 10)}: {entry.actorName} — {entry.reason} (until {entry.until.toISOString().slice(0, 10)})</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <Link href={item.primaryAction?.href ?? item.href}
                      className="inline-flex min-h-11 items-center rounded-control border border-line px-3 text-sm font-medium text-link">
                      {item.primaryAction?.label ?? "Review item"}
                    </Link>
                    {item.snooze && unsnoozeAction && item.todoKey ? (
                      <form action={unsnoozeAction}>
                        <input type="hidden" name="key" value={item.todoKey} />
                        <button type="submit" className="min-h-11 text-sm text-link underline">
                          Resume now
                        </button>
                      </form>
                    ) : null}
                    {!item.snooze && snoozeAction && item.todoKey ? (
                      <details className="text-sm">
                        <summary className="min-h-11 cursor-pointer text-link">Snooze until…</summary>
                        <form action={snoozeAction} className="grid gap-2 rounded-control border border-line p-3">
                          <input type="hidden" name="key" value={item.todoKey} />
                          <label htmlFor={"snooze-date-" + item.todoKey}>Resume date (up to 90 days)</label>
                          <input id={"snooze-date-" + item.todoKey} name="until" type="date" required className="rounded-control border border-line p-2" />
                          <label htmlFor={"snooze-reason-" + item.todoKey}>Reason for snoozing</label>
                          <input id={"snooze-reason-" + item.todoKey} name="reason" minLength={3} maxLength={500} required className="rounded-control border border-line p-2" />
                          <button type="submit" className="min-h-11 rounded-control bg-ink px-3 text-white">Save snooze</button>
                        </form>
                      </details>
                    ) : null}
                    {item.sourceHref ? (
                      <a
                        href={item.sourceHref}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex min-h-11 items-center text-sm font-medium text-link underline-offset-2 hover:underline"
                      >
                        {item.sourceLabel ?? "Open source"}
                      </a>
                    ) : null}
                    {item.action?.type === "ACK_TAX_SOURCE_CHANGE" &&
                    acknowledgeTaxSourceAction ? (
                      <form action={acknowledgeTaxSourceAction}>
                        <input type="hidden" name="watchId" value={item.action.id} />
                        <input
                          type="hidden"
                          name="watchVersion"
                          value={item.action.version}
                        />
                        <button
                          type="submit"
                          className="min-h-11 rounded-control px-3 text-sm font-medium text-ink underline-offset-2 hover:bg-subtle hover:underline"
                        >
                          {item.action.label}
                        </button>
                      </form>
                    ) : null}
                    {item.action?.type === "UNDO_OFFICIAL_RATE" &&
                    undoOfficialRateAction ? (
                      <form action={undoOfficialRateAction}>
                        <input
                          type="hidden"
                          name="rateVersionId"
                          value={item.action.id}
                        />
                        <button
                          type="submit"
                          className="min-h-11 rounded-control px-3 text-sm font-medium text-ink underline-offset-2 hover:bg-subtle hover:underline"
                        >
                          {item.action.label}
                        </button>
                      </form>
                    ) : null}
                    {item.action?.type === "APPLY_OFFICIAL_RATE" &&
                    applyOfficialRateAction ? (
                      <form action={applyOfficialRateAction}>
                        <input
                          type="hidden"
                          name="observationId"
                          value={item.action.id}
                        />
                        <button
                          type="submit"
                          className="min-h-11 rounded-control px-3 text-sm font-medium text-ink underline-offset-2 hover:bg-subtle hover:underline"
                        >
                          {item.action.label}
                        </button>
                      </form>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
            {more > 0 && (
              <p className="mt-2 text-sm font-medium text-ink-soft">
                and {more} more
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
