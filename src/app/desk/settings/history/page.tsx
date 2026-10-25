import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/session";
import {
  listSettingsHistory,
  previewSettingsUndo,
  undoSettingsChange,
  SettingsUndoError,
} from "@/domains/settings/history";
import { SettingsConflictError } from "@/domains/settings/effects";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";

export const metadata = { title: "Settings history", robots: { index: false, follow: false } };

/** Fixed result codes only: the page never prints text taken from the address bar. */
const RESULT_MESSAGES: Record<string, { kind: "ok" | "problem"; text: string }> = {
  undone: { kind: "ok", text: "Undone. The setting is back to what it was before that change, and the undo is in the history below." },
  conflict: {
    kind: "problem",
    text: "Someone else changed this setting while you were looking at it, so nothing was undone. The list below is up to date; look again before deciding.",
  },
  refused: { kind: "problem", text: "That change can no longer be undone, so it was left alone. The reason is shown next to it below." },
};

async function confirmUndo(form: FormData) {
  "use server";
  const session = await requireRole("OWNER", "ADMIN");
  const id = String(form.get("auditId") ?? "");
  const key = String(form.get("key") ?? "");
  const expectedCurrent = String(form.get("expectedCurrent") ?? "");
  let result = "undone";
  try {
    await undoSettingsChange(session.user.id, id, key, expectedCurrent);
  } catch (e) {
    if (e instanceof SettingsConflictError) result = "conflict";
    else if (e instanceof SettingsUndoError) result = "refused";
    else throw e;
  }
  revalidatePath("/desk/settings/history");
  redirect(`/desk/settings/history?result=${result}`);
}

type SearchParams = Promise<{ undo?: string; key?: string; result?: string }>;

export default async function SettingsHistoryPage({ searchParams }: { searchParams: SearchParams }) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const notice = params.result ? RESULT_MESSAGES[params.result] : undefined;
  const preview = params.undo && params.key ? await previewSettingsUndo(params.undo, params.key) : null;
  const rows = await listSettingsHistory();
  return (
    <main className="mx-auto max-w-3xl space-y-5">
      <Link href="/desk/settings" className="text-sm underline">Back to settings</Link>
      <h1 className="text-xl font-semibold">Settings history</h1>
      <p className="text-sm text-ink-soft">
        Every change to your business settings, newest first. You can undo one change at a time, but only while that setting
        still has the value the change gave it. You see what an undo will do before it happens. Undo never changes agreements
        customers already signed, and it never touches email, tax, security or contract-term settings (those have their own
        screens).
      </p>
      {notice && (
        <p role={notice.kind === "problem" ? "alert" : "status"} className="rounded-md border p-3 text-sm font-medium">
          {notice.text}
        </p>
      )}
      {preview && (
        <section aria-label="Check this undo" className="space-y-3 rounded-md border-2 p-4">
          {preview.ok ? (
            <>
              <h2 className="text-base font-semibold">Undo this change?</h2>
              <p className="text-sm">
                <span className="font-medium">{preview.label}:</span> {preview.current} → {preview.restored}
              </p>
              <p className="text-sm text-ink-soft">{preview.effect}</p>
              <p className="text-sm text-ink-soft">Nothing has been changed yet.</p>
              <div className="flex flex-wrap gap-3">
                <form action={confirmUndo}>
                  <input type="hidden" name="auditId" value={params.undo} />
                  <input type="hidden" name="key" value={preview.key} />
                  <input type="hidden" name="expectedCurrent" value={preview.expectedCurrent} />
                  <button type="submit" className="rounded-md border px-3 py-2 font-medium">Yes, undo it</button>
                </form>
                <Link href="/desk/settings/history" className="rounded-md border px-3 py-2">No, leave it as it is</Link>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-base font-semibold">This cannot be undone</h2>
              <p className="text-sm">{preview.reason}</p>
              <Link href="/desk/settings/history" className="text-sm underline">Back to the list</Link>
            </>
          )}
        </section>
      )}
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
                        <Link
                          href={`/desk/settings/history?undo=${encodeURIComponent(r.id)}&key=${encodeURIComponent(c.key)}`}
                          className="rounded-md border px-3 py-1"
                          aria-label={`Review undoing ${c.label}`}
                        >
                          Undo this
                        </Link>
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
