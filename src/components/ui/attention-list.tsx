import Link from "next/link";
import type { ExceptionItem } from "@/domains/exceptions";

export type AttentionGroup = {
  category: string;
  title: string;
  total: number;
  items: ExceptionItem[];
};

export function AttentionList({
  groups,
  acknowledgeTaxSourceAction,
  undoOfficialRateAction,
  applyOfficialRateAction,
}: {
  groups: AttentionGroup[];
  acknowledgeTaxSourceAction?: (formData: FormData) => Promise<void>;
  undoOfficialRateAction?: (formData: FormData) => Promise<void>;
  applyOfficialRateAction?: (formData: FormData) => Promise<void>;
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
                  className="py-3"
                >
                  <Link
                    href={item.href}
                    className="block min-h-11 hover:bg-subtle"
                  >
                    <span className="font-medium text-ink">{item.title}</span>
                    <span className="mt-1 block text-sm text-ink-soft">
                      {item.detail}
                    </span>
                  </Link>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
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
