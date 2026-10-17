import Link from "next/link";
import { getRecordConnections, type ConnectionKind } from "@/domains/connections";

/** W-17: "Related" and "History" for a main record. Owner/admin pages only. */
export async function RecordConnections({ kind, id, showHistory = true }: { kind: ConnectionKind; id: string; showHistory?: boolean }) {
  const { related, history } = await getRecordConnections(kind, id);
  const groups = new Map<string, typeof related>();
  for (const link of related) groups.set(link.group, [...(groups.get(link.group) ?? []), link]);
  return (
    <section aria-label="Related records and history" className={"mt-6 grid gap-4 " + (showHistory ? "md:grid-cols-2" : "")}>
      <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">Related</h2>
        {related.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Nothing else is connected to this yet.</p>
        ) : (
          <div className="mt-3 space-y-3">
            {[...groups.entries()].map(([group, links]) => (
              <div key={group}>
                <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">{group}</p>
                <ul className="mt-1 space-y-1 text-sm">
                  {links.map((l) => (
                    <li key={l.href}><Link href={l.href} className="text-primary underline">{l.text}</Link></li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
      {showHistory && <div className="rounded-lg border border-line bg-white p-5">
        <h2 className="font-medium text-ink">History</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-ink-soft">Nothing has been recorded for this yet.</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {history.map((h) => (
              <li key={h.id} className="text-sm">
                <p className="text-ink">{h.what}</p>
                {h.detail && <p className="text-ink-soft">{h.detail}</p>}
                <p className="text-xs text-ink-faint">{h.who} · {h.at.toLocaleString("en-US", { timeZone: "America/Denver" })}</p>
              </li>
            ))}
          </ul>
        )}
      </div>}
    </section>
  );
}
