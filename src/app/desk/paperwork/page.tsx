import Link from "next/link";
import { requireRole } from "@/lib/session";
import { listPaperwork } from "@/domains/paperwork";
import {
  PAPERWORK_GROUPS,
  PAPERWORK_STATUS_LABEL,
  maskReference,
  reminderState,
  type PaperworkStatusValue,
} from "@/domains/paperwork/rules";
import { businessDateKey } from "@/lib/business-date";
import { Button, ButtonLink, Card, EmptyState, PageHeader, StatusPill } from "@/components/ui";
import { addStarterChecklistAction } from "./actions";

export const metadata = { title: "Business paperwork" };
export const dynamic = "force-dynamic";

function dueText(state: ReturnType<typeof reminderState>, dueOn: Date | null) {
  if (!dueOn) return "No date set";
  const day = businessDateKey(dueOn);
  if (state.kind === "overdue") return `Overdue by ${state.daysOver} ${state.daysOver === 1 ? "day" : "days"} (${day})`;
  if (state.kind === "none") return `Date: ${day}`;
  if (state.daysLeft === 0) return `Due today (${day})`;
  return `Due ${day} (in ${state.daysLeft} ${state.daysLeft === 1 ? "day" : "days"})`;
}

export default async function PaperworkPage() {
  const session = await requireRole("OWNER");
  const items = await listPaperwork(session.user.role);
  const now = new Date();
  const rows = items.map((item) => ({
    item,
    state: reminderState(
      { status: item.status as PaperworkStatusValue, dueOn: item.dueOn, remindDaysBefore: item.remindDaysBefore },
      now,
    ),
  }));
  const needsAttention = rows.filter(({ state }) => state.kind === "overdue" || state.kind === "due_soon");
  const stepsLeft = rows.filter(({ item }) => item.templateKey && !item.dueOn && (item.status === "TO_DO" || item.status === "IN_PROGRESS")).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Business paperwork"
        description="Your LLC, EIN, licenses, insurance and yearly filings in one place. Add the date something is due and you'll get a reminder on your Today list. Only the owner can see this page."
        primaryAction={<ButtonLink href="/desk/paperwork/new">Add your own item</ButtonLink>}
      />

      {items.length === 0 ? (
        <EmptyState
          title="Nothing here yet"
          description="Start with a checklist for a new Colorado rental business: register the LLC, get your EIN, get your sales tax license, insurance and the yearly report. You can change, skip or add to any of it. The checklist doesn't state any fees or deadlines; you enter the dates from your own papers."
          action={
            <form action={addStarterChecklistAction}>
              <Button type="submit">Set up my starter checklist</Button>
            </form>
          }
        />
      ) : (
        <>
          {needsAttention.length > 0 && (
            <Card title="Needs your attention" description="Due soon or already past due.">
              <ul className="divide-y divide-line">
                {needsAttention.map(({ item, state }) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/desk/paperwork/${item.id}`} className="font-semibold text-action underline">{item.title}</Link>
                      <p className="text-sm text-ink-soft">{dueText(state, item.dueOn)}</p>
                    </div>
                    <StatusPill tone={state.kind === "overdue" ? "attention" : "pending"} label={state.kind === "overdue" ? "Overdue" : "Coming up"} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {stepsLeft > 0 && (
            <p className="text-sm text-ink-soft">
              {stepsLeft} setup {stepsLeft === 1 ? "step is" : "steps are"} still to do. Open one, fill in what you know, and mark where you are with it.
            </p>
          )}
          {PAPERWORK_GROUPS.map((group) => {
            const groupRows = rows.filter(({ item }) => item.groupName === group);
            if (groupRows.length === 0) return null;
            return (
              <Card key={group} title={group}>
                <ul className="divide-y divide-line">
                  {groupRows.map(({ item, state }) => (
                    <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <Link href={`/desk/paperwork/${item.id}`} className="font-semibold text-action underline">{item.title}</Link>
                        <p className="text-sm text-ink-soft">
                          {item.status === "NOT_NEEDED" ? "Not needed" : dueText(state, item.dueOn)}
                          {item.referenceNumber ? ` · Number ${maskReference(item.referenceNumber)}` : ""}
                        </p>
                      </div>
                      <StatusPill
                        tone={item.status === "DONE" ? "success" : item.status === "IN_PROGRESS" ? "progress" : item.status === "NOT_NEEDED" ? "stopped" : "pending"}
                        label={PAPERWORK_STATUS_LABEL[item.status as PaperworkStatusValue]}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
          <form action={addStarterChecklistAction}>
            <Button type="submit" variant="secondary">Add any missing starter items</Button>
            <p className="mt-2 text-xs text-ink-soft">Brings back starter items you haven&apos;t got yet. Nothing you&apos;ve entered is changed.</p>
          </form>
        </>
      )}
    </div>
  );
}
