import Link from "next/link";
import type { ExceptionItem } from "@/domains/exceptions";

export type AttentionGroup = {
  category: string;
  title: string;
  total: number;
  items: ExceptionItem[];
};

export function AttentionList({ groups }: { groups: AttentionGroup[] }) {
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
                  key={`${item.category}:${item.href}:${item.since.toISOString()}`}
                >
                  <Link
                    href={item.href}
                    className="block min-h-11 py-3 hover:bg-subtle"
                  >
                    <span className="font-medium text-ink">{item.title}</span>
                    <span className="mt-1 block text-sm text-ink-soft">
                      {item.detail}
                    </span>
                  </Link>
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
