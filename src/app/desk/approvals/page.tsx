import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listDecidedApprovals, listWaitingApprovals } from "@/domains/approvals";
import { OUTCOME_WORDS, STATUS_WORDS } from "@/domains/approvals/words";
import { decideApprovalFormAction, finishApprovalFormAction } from "./actions";
import { formatBusinessDate, formatBusinessTime } from "@/lib/business-date";
import { formatMoney } from "@/lib/money-ui";

export const metadata = { title: "Approvals", robots: { index: false, follow: false } };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  await requireRole("OWNER");
  const outcome = (await searchParams).outcome;
  const [waiting, decided] = await Promise.all([listWaitingApprovals(), listDecidedApprovals()]);
  return (
    <main className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold">Approvals</h1>
      <p className="text-sm text-ink-soft">
        When an admin starts a write-off, expense, refund, deposit decision or credit at or above your limit, it waits here and nothing happens until
        you decide. Approving does it right now, as you. <Link href="/desk/settings/approvals" className="underline">Change your limits</Link>.
      </p>
      {outcome && OUTCOME_WORDS[outcome] && <p role="status" className="rounded-md border p-3 text-sm">{OUTCOME_WORDS[outcome]}</p>}
      <section aria-labelledby="waiting-h" className="space-y-3">
        <h2 id="waiting-h" className="font-semibold">Waiting for you ({waiting.length})</h2>
        {waiting.length === 0 && <p className="rounded-md border p-4 text-sm">Nothing is waiting. Limits are set under <Link href="/desk/settings/approvals" className="underline">Settings</Link>; until you set one, admins act without asking.</p>}
        {waiting.map((r) => (
          <form key={r.id} action={decideApprovalFormAction} className="space-y-2 rounded-md border p-4">
            <input type="hidden" name="requestId" value={r.id} />
            <p className="font-medium">{r.summary}</p>
            <p className="text-xs text-ink-soft">
              Asked by {r.requestedBy} on {formatBusinessDate(r.createdAt)} {formatBusinessTime(r.createdAt)} · {formatMoney(r.amountCents)} ·{" "}
              {r.expired ? "expired, so it can no longer be approved" : `expires ${formatBusinessDate(r.expiresAt)}`}
            </p>
            <label htmlFor={`note-${r.id}`} className="block text-sm">Note (optional)</label>
            <input id={`note-${r.id}`} name="note" maxLength={300} className="w-full rounded-md border bg-surface p-2" />
            <div className="flex flex-wrap gap-3">
              <button name="decision" value="APPROVE" type="submit" className="min-h-11 rounded-md border px-4 py-2 font-medium">Approve and do it now</button>
              <button name="decision" value="DECLINE" type="submit" className="min-h-11 rounded-md border px-4 py-2">Decline</button>
            </div>
          </form>
        ))}
      </section>
      {decided.length > 0 && (
        <section aria-labelledby="done-h" className="space-y-2">
          <h2 id="done-h" className="font-semibold">Recently decided</h2>
          <ul className="space-y-2 text-sm">
            {decided.map((r) => (
              <li key={r.id} className="rounded-md border p-3">
                <p>{r.status === "APPROVED" && !r.finished ? "Approved, but not confirmed as finished" : STATUS_WORDS[r.status] ?? r.status}: {r.summary}</p>
                {r.status === "APPROVED" && !r.finished && <p className="text-xs">{r.stateNote ?? "Nothing has been sent yet, or it was interrupted. Use “Check and finish” below; it first looks for the refund so the money is never sent twice."}</p>}
                {r.canFinish && (
                  <form action={finishApprovalFormAction} className="mt-2">
                    <input type="hidden" name="requestId" value={r.id} />
                    <button type="submit" className="min-h-11 rounded-md border px-4 py-2 text-sm">Check and finish</button>
                  </form>
                )}
                <p className="text-xs text-ink-soft">
                  Asked by {r.requestedBy}{r.decidedAt ? ` · decided ${formatBusinessDate(r.decidedAt)}` : ""}
                  {r.decisionNote ? ` · note: ${r.decisionNote}` : ""}{r.failureMessage ? ` · ${r.failureMessage}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
