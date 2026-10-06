import type { ApplianceHistoryEntry } from "@/domains/inventory/guided-actions";

const KIND_LABELS: Record<ApplianceHistoryEntry["kind"], string> = {
  status_change: "Status",
  job: "Job",
  inspection: "Inspection",
  custody: "Custody",
};

/** This appliance's own chronological history — every status change, job,
 * and inspection, newest first. Plain server-rendered list; nothing here
 * is interactive. See getApplianceHistory in
 * src/domains/inventory/guided-actions.ts. */
export function HistoryTimeline({ entries }: { entries: ApplianceHistoryEntry[] }) {
  return (
    <div className="rounded-lg border border-line bg-white p-5">
      <h2 className="font-medium text-ink">History</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-soft">Nothing recorded for this unit yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className="text-ink">
                <span className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  {KIND_LABELS[entry.kind]}
                </span>{" "}
                {entry.summary}
              </p>
              {entry.detail && <p className="text-ink-soft">{entry.detail}</p>}
              <p className="text-xs text-ink-faint">
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
