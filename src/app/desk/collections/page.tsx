import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { Card, PageHeader } from "@/components/ui";
import { businessDateKey } from "@/lib/business-date";
import { readLadder, readNoticeWording } from "@/domains/collections/engine";
import { listCollectionWork } from "@/domains/collections/reads";
import { daysPastDue } from "@/domains/collections/rules";
import { skipNoticeAction, sendNoticeAction } from "./actions";
import { DEFAULT_HELP_TEXT, DEFAULT_PAY_HOW } from "@/domains/collections/templates";
import { LadderForm, NoteAction, WordingForm } from "./controls";

export const metadata = { title: "Past-due follow-up" };


export default async function CollectionsPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const [work, ladder, wording] = await Promise.all([listCollectionWork(), readLadder(), readNoticeWording()]);
  const nowKey = businessDateKey(new Date());
  const notices = work.filter((s) => s.kind === "SECOND_NOTICE" || s.kind === "FINAL_NOTICE");
  const others = work.filter((s) => s.kind === "DECISION" || s.kind === "SMALL_CLAIMS");
  return (
    <div className="space-y-6">
      <PageHeader title="Past-due follow-up" />
      <p className="text-sm text-ink-soft">
        When a bill is late, the app prepares the next step and waits for you. Nothing is sent to a customer, and no appliance is picked up, until you approve it. Every message is written in {`"Robinson Appliance Rentals"`}&apos;s own name.
      </p>
      <Card title="Notices waiting for you">
        {notices.length === 0 ? (
          <p className="text-sm text-ink-soft">None. A notice appears here when a bill passes the day set below.</p>
        ) : (
          <ul className="space-y-6">
            {notices.map((step) => {
              const who = step.customer.user.name ?? step.customer.user.email;
              const late = step.invoice ? daysPastDue(businessDateKey(step.cameUpOn), nowKey) : 0;
              return (
                <li key={step.id} className="space-y-3 border-b border-line pb-6 last:border-0">
                  <p className="font-semibold">{step.kind === "FINAL_NOTICE" ? "Final notice" : "Second notice"}: {who} — bill #{step.invoice.invoiceNumber}, {formatMoney(step.amountOwedCents)} owed{late > 0 ? ` (came up ${late} days ago)` : ""}</p>
                  <div className="rounded-control border border-line p-3 text-sm">
                    <p className="font-medium">{step.subject}</p>
                    <p className="mt-2 whitespace-pre-line">{step.body}</p>
                  </div>
                  <div className="flex flex-wrap items-start gap-4">
                    <NoteAction label="Send this email" run={sendNoticeAction.bind(null, step.id)} />
                    <NoteAction label="Skip" secondary noteLabel="Why skip it?" needsNote run={skipNoticeAction.bind(null, step.id)} />
                    {step.kind === "FINAL_NOTICE" && <a className="min-h-11 self-center text-sm font-semibold underline" href={`/desk/collections/notice/${step.id}/letter`} target="_blank" rel="noopener noreferrer">Open the printable letter (PDF)</a>}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card title="Decisions and court steps">
        {others.length === 0 ? <p className="text-sm text-ink-soft">None right now.</p> : (
          <ul className="divide-y divide-line">
            {others.map((step) => (
              <li key={step.id} className="py-3">
                <Link className="font-semibold underline" href={`/desk/collections/${step.invoice.agreementId}`}>
                  {step.kind === "DECISION" ? "Decide what to do" : "Small claims"}: {step.customer.user.name ?? step.customer.user.email} — {formatMoney(step.amountOwedCents)}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="When each step comes up" description="Counted in days after a bill's due date.">
        <LadderForm secondNotice={ladder.secondNotice} finalNotice={ladder.finalNotice} decision={ladder.decision} editable={session.user.role === "OWNER"} />
      </Card>
      <Card title="Wording of the notices" description="Two lines you can change.">
        <WordingForm payHowText={wording.payHowText ?? ""} helpText={wording.helpText ?? ""} defaultPayHow={DEFAULT_PAY_HOW} defaultHelp={DEFAULT_HELP_TEXT} editable={session.user.role === "OWNER"} />
      </Card>
    </div>
  );
}
