import Link from "next/link";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import { listSettingsHistory, undoSettingsChange, SettingsUndoError } from "@/domains/settings/history";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

export const metadata = { title: "Settings history", robots: { index: false, follow: false } };

async function undo(form: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const id = String(form.get("auditId") ?? "");
  const key = String(form.get("key") ?? "");
  try {
    await undoSettingsChange(session.user.id, id, key);
  } catch (e) {
    if (!(e instanceof SettingsUndoError)) throw e;
  }
  revalidatePath("/desk/settings/history");
}

export default async function SettingsHistoryPage() {
  await requireRole("OWNER", "ADMIN");
  const rows = await listSettingsHistory();
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Settings history</h1>
      <p className="text-sm text-ink-soft">
        Every change to your business settings, newest first. You can undo one change at a time, but only while that setting
        still has the value the change gave it. Undo never changes agreements customers already signed, and it never touches
        email, tax, security or contract-term settings (those have their own screens).
      </p>
      {rows.length === 0 && <p className="rounded-md border p-4 text-sm">No settings changes have been saved yet.</p>}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="rounded-md border p-3">
            <p className="text-sm font-medium">
              {r.isUndo ? "Undo" : "Change"} by {r.by} · {formatBusinessDate(r.at)} {formatBusinessTime(r.at)}
            </p>
            {r.changes.length === 0 ? (
              <p className="text-sm text-ink-soft">Saved with no visible difference.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {r.changes.map((c) => {
                  const u = r.undo.find((x) => x.key === c.key);
                  return (
                    <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>{c.label}: {c.from} → {c.to}</span>
                      {u?.ok ? (
                        <form action={undo}>
                          <input type="hidden" name="auditId" value={r.id} />
                          <input type="hidden" name="key" value={c.key} />
                          <button type="submit" className="rounded-md border px-3 py-1">Undo this</button>
                        </form>
                      ) : (
                        <span className="text-xs text-ink-soft">
                          {u ? u.reason : "Change this one on its own settings screen."}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </main>
  );
}
