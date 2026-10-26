// AR-0 kit 4.10: what happened on a record, newest first: a tone dot, the title, then "{date} · {who}".
// AR-0b: an item may carry `href` (the related record); its title is then a link.
import Link from "next/link";
import { formatShortDate } from "@/lib/business-date";
import { TONE_DOT, type Tone } from "./types";

export type TimelineItem = { id: string; at: Date; title: string; detail?: string; tone: Tone; actor: string; href?: string };

export function Timeline({ items, emptyLabel, now = new Date() }: { items: TimelineItem[]; emptyLabel: string; now?: Date }) {
  if (items.length === 0) return <p className="py-4 text-sm text-ink-soft">{emptyLabel}</p>;
  const ordered = [...items].sort((a, b) => b.at.getTime() - a.at.getTime());
  return (
    <ol className="flex flex-col">
      {ordered.map((item) => (
        <li key={item.id} className="flex gap-3 py-2.5">
          <span aria-hidden="true" data-tone={item.tone} className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TONE_DOT[item.tone]}`} />
          <div className="min-w-0">
            <p className="font-bold text-ink">
              {item.href ? (
                <Link href={item.href} className="text-primary hover:underline">
                  {item.title}
                </Link>
              ) : (
                item.title
              )}
            </p>
            {item.detail ? <p className="whitespace-pre-wrap break-words text-sm text-ink-soft">{item.detail}</p> : null}
            <p className="text-xs text-ink-soft">
              {formatShortDate(item.at, now)} · {item.actor}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
