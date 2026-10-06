import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import {
  messageStateLabel,
  type MessageHistoryRow,
} from "@/domains/messaging/history";

function templateLabel(value: string): string {
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function MessageHistoryPanel({ rows }: { rows: MessageHistoryRow[] }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5" aria-labelledby="messages-heading">
      <h2 id="messages-heading" className="font-medium text-ink">Messages</h2>
      <p className="mt-1 text-xs text-ink-faint">
        Provider acceptance is not the same as delivery. Unknown, failed and not-sent messages stay labelled that way.
      </p>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-ink-soft">No recorded business messages for this record.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium text-ink">
                  {templateLabel(row.templateKey)} · {row.channel === "EMAIL" ? "Email" : "Text"}
                </p>
                <p className="font-medium text-ink-soft">{messageStateLabel(row.state)}</p>
              </div>
              <p className="mt-1 break-all text-xs text-ink-faint">To {row.recipientAddress}</p>
              <time className="text-xs text-ink-faint" dateTime={row.requestedAt.toISOString()}>
                Requested {formatBusinessDate(row.requestedAt)} · {formatBusinessTime(row.requestedAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
