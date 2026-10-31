import { requireRole } from "@/lib/session";
import {
  countRetiredByState, getRetiredFollowUpDays, listDepositAccounts, listRetiredAppliances, listScrapPayments, planChoiceLabel, retirementIsOverdue, RETIRED_LIST_LIMIT,
  type RetiredFilter,
} from "@/domains/inventory/retired-plans";
import { applianceSubtitle, applianceTitle } from "@/domains/inventory/words";
import { formatShortDate } from "@/lib/business-date";
import { EmptyState } from "@/components/ui";
import { ScreenHeader, StatusTabs } from "@/components/kit";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { RetiredList } from "./retired-list";
import { ScrapMoney } from "./scrap-money";
import { prisma } from "@/lib/prisma";
import { saveRefrigerantTypesAction } from "./refrigerant-types-action";

export const metadata = { title: "Retired appliances" };

const FILTERS: Array<{ value: RetiredFilter; label: string }> = [
  { value: "ALL", label: "All" },
  { value: "DECIDE_LATER", label: "Decide later" },
  { value: "SELL", label: "Sell" },
  { value: "STRIP", label: "Parts" },
  { value: "SCRAP", label: "Scrap" },
  { value: "DISPOSE", label: "Throw away" },
  { value: "OTHER", label: "Other" },
  { value: "DONE", label: "Done" },
];

export default async function RetiredAppliancesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const session = await requireRole("OWNER", "ADMIN");
  const { show } = await searchParams;
  const filter = (FILTERS.find((f) => f.value === show)?.value ?? "ALL") as RetiredFilter;
  const [rows, counts, scrap, accounts, followUpDays] = await Promise.all([
    listRetiredAppliances(session.user.id, filter),
    countRetiredByState(session.user.id),
    listScrapPayments(session.user.id),
    listDepositAccounts(session.user.id),
    getRetiredFollowUpDays(),
  ]);
  const types = session.user.role === "OWNER" ? await prisma.applianceType.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, hasRefrigerant: true } }) : [];
  const today = businessDateKey(new Date());
  const listLimit = RETIRED_LIST_LIMIT;
  return (
    <main className="space-y-8">
      <ScreenHeader title="Retired appliances" />
      <p className="-mt-2 pb-2 text-sm text-ink-soft">
        {`${counts.waiting} waiting on a decision or not finished · ${counts.done} done. Retired appliances can't be rented. Choose what happens to each one.`}
      </p>
      <StatusTabs
        label="Filter retired appliances"
        param="show"
        current={filter}
        items={FILTERS.map((f) => ({
          value: f.value,
          label: f.label,
          count:
            f.value === "ALL" ? counts.all
            : f.value === "DECIDE_LATER" ? counts.decideLater
            : f.value === "DONE" ? counts.done
            : undefined,
        }))}
      />
      {rows.length === 0 ? (
        <EmptyState title="Nothing here" description="Appliances you retire from an appliance's page show up in this list." />
      ) : (
        <RetiredList
          today={today}
          rows={rows.map((r) => {
            // No dedicated retired-at column exists: the plan's decision
            // date, else the row's last change (retirement, until touched).
            const retiredOn = r.retiredPlan?.decidedAt ?? r.updatedAt;
            const overdue =
              !r.retiredPlan?.doneOn && retirementIsOverdue(retiredOn, new Date(), followUpDays);
            return {
              id: r.id,
              title: applianceTitle(r),
              detail: `Retired ${formatShortDate(retiredOn)} · ${applianceSubtitle(r)}`,
              status: r.retiredPlan ? `${planChoiceLabel(r.retiredPlan.choice)}${r.retiredPlan.doneOn ? ` · done ${formatBusinessDate(r.retiredPlan.doneOn)}` : ""}` : "Decide later",
              chip: overdue ? "Follow-up due" : undefined,
              bulkEligible: !!r.retiredPlan && !r.retiredPlan.doneOn && ["SCRAP", "DISPOSE", "OTHER"].includes(r.retiredPlan.choice),
            };
          })}
        />
      )}
      {rows.length >= listLimit && <p className="text-sm text-ink-soft">Showing the {listLimit} most recently changed.</p>}
      {/* AR-6 drift: the follow-up-days editor moved to Settings (AR-8's
          catalog row retiredFollowUpDays); this page only reads the value
          for the Follow-up due chip. */}
      {types.length > 0 && (
        <section className="rounded-card border border-line bg-surface p-5" aria-labelledby="refrigerant-types-heading">
          <h2 id="refrigerant-types-heading" className="text-lg font-semibold">Which appliances have refrigerant?</h2>
          <p className="mt-1 text-sm text-ink-soft">
            Refrigerators, freezers and mini-fridges (starting value, not confirmed) need a signed refrigerant statement before they can be marked scrapped or thrown away. Washers and dryers don&apos;t. This only affects appliances you finish from now on.
          </p>
          <form action={saveRefrigerantTypesAction} className="mt-3 grid gap-1">
            {types.map((t) => (
              <label key={t.id} className="flex min-h-11 items-center gap-3 text-sm">
                <input type="checkbox" name="typeId" value={t.id} defaultChecked={t.hasRefrigerant} className="h-5 w-5" />
                {t.name}
              </label>
            ))}
            <div><button type="submit" className="min-h-11 rounded-control bg-brand px-4 font-semibold text-white">Save</button></div>
          </form>
        </section>
      )}
      <ScrapMoney
        today={today}
        accounts={accounts}
        payments={scrap.map((p) => ({
          id: p.id, date: formatBusinessDate(p.receivedOn), amountCents: p.amountCents, yardName: p.yardName, note: p.note,
          voided: p.voidedAt !== null, voidReason: p.voidReason,
        }))}
      />
    </main>
  );
}
