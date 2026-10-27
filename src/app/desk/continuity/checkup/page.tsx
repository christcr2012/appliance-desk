import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/prisma";
import { CHECKUP_ITEMS, checkupYear } from "@/domains/continuity/rules";
import { completeCheckupAction } from "../actions";
import { ContinuityForm } from "../forms";

export const metadata = { title: "Yearly business check-up" };

export default async function CheckupPage() {
  await requireRole("OWNER");
  const year = checkupYear(new Date());
  const done = await prisma.yearlyCheckup.findUnique({ where: { year } });
  return (
    <div className="space-y-6">
      <PageHeader title={`Yearly business check-up ${year}`} />
      <p className="text-sm text-ink-soft">
        A once-a-year walk through the things that quietly go out of date. Open each screen, look, and tick what you checked. Ticking records that you looked; it changes nothing else.
        Back to <Link className="underline" href="/desk/continuity">If something happens to me</Link>.
      </p>
      {done ? (
        <p role="status" className="rounded-control border border-line p-3 text-sm">
          Finished on {new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", dateStyle: "medium" }).format(done.completedAt)}. Checked {Array.isArray(done.ticked) ? done.ticked.length : 0} of {CHECKUP_ITEMS.length} items.
        </p>
      ) : (
        <Card title="The walkthrough">
          <ContinuityForm action={completeCheckupAction} submit={`Finish the ${year} check-up`}>
            <ul className="space-y-3">
              {CHECKUP_ITEMS.map((item) => (
                <li key={item.key} className="flex gap-3">
                  <input id={`t-${item.key}`} type="checkbox" name="ticked" value={item.key} className="mt-1 h-5 w-5" />
                  <div>
                    <label htmlFor={`t-${item.key}`} className="font-medium">{item.label}</label>
                    <p className="text-sm text-ink-soft">{item.detail} <Link className="underline" href={item.href}>Open</Link></p>
                  </div>
                </li>
              ))}
            </ul>
            <label className="grid gap-1 text-sm font-medium">Notes for next year (optional)
              <textarea name="note" rows={3} maxLength={1000} className="rounded-control border border-line p-2" />
            </label>
          </ContinuityForm>
        </Card>
      )}
    </div>
  );
}
