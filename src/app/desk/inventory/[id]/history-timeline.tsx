import type { ApplianceHistoryEntry } from "@/domains/inventory/guided-actions";

const KIND_LABELS: Record<ApplianceHistoryEntry["kind"], string> = {
  status_change: "Status",
  job: "Job",
  inspection: "Inspection",
};

/** This appliance's own chronological history — every status change, job,
 * and inspection, newest first. Plain server-rendered list; nothing here
 * is interactive. See getApplianceHistory in
 * src/domains/inventory/guided-actions.ts. */
export function HistoryTimeline({ entries }: { entries: ApplianceHistoryEntry[] }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="font-medium text-gray-900">History</h2>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-gray-600">Nothing recorded for this unit yet.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="text-sm">
              <p className="text-gray-900">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
                  {KIND_LABELS[entry.kind]}
                </span>{" "}
                {entry.summary}
              </p>
              {entry.detail && <p className="text-gray-600">{entry.detail}</p>}
              <p className="text-xs text-gray-400">
                {new Date(entry.createdAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
