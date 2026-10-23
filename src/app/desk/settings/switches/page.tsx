import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listSwitches } from "@/domains/settings/switches";
import { formatBusinessDate } from "@/lib/business-date";

export const metadata = { title: "Switches", robots: { index: false, follow: false } };

export default async function SwitchesPage() {
  await requireRole("OWNER", "ADMIN");
  const rows = await listSwitches();
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Switches</h1>
      <p className="text-sm text-ink-soft">
        Everything that can send something to a customer or move money, in one place. This page only shows the current state;
        use the link on each row to change it. Secret keys are never shown.
      </p>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3">
            <div>
              <p className="font-medium">{r.name}</p>
              <p className="text-sm">{r.state}</p>
              {r.lastChange && (
                <p className="text-xs text-ink-soft">Last changed by {r.lastChange.by} on {formatBusinessDate(r.lastChange.at)}</p>
              )}
            </div>
            <Link href={r.changeAt} className="text-sm underline">Where to change it</Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
