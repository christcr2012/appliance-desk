import Link from "next/link";
import { requireRole } from "@/lib/session";
import {
  countRetiredByState, getRetiredFollowUpDays, listDepositAccounts, listRetiredAppliances, listScrapPayments, planChoiceLabel, RETIRED_LIST_LIMIT,
  type RetiredFilter,
} from "@/domains/inventory/retired-plans";
import { EmptyState, PageHeader } from "@/components/ui";
import { businessDateKey, formatBusinessDate } from "@/lib/business-date";
import { RetiredList } from "./retired-list";
import { ScrapMoney } from "./scrap-money";
import { ReminderSetting } from "./reminder-setting";

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
  const today = businessDateKey(new Date());
  const listLimit = RETIRED_LIST_LIMIT;
  return (
    <main className="space-y-8">
      <PageHeader
        title="Retired appliances"
        description={`${counts.waiting} waiting on a decision or not finished · ${counts.done} done. Retired appliances can't be rented. Choose what happens to each one.`}
      />
      <nav aria-label="Filter retired appliances" className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.value}
            href={f.value === "ALL" ? "/desk/inventory/retired" : `/desk/inventory/retired?show=${f.value}`}
            aria-current={f.value === filter ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-control border px-3 text-sm font-semibold ${f.value === filter ? "border-primary bg-subtle text-ink" : "border-line text-ink-soft"}`}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState title="Nothing here" description="Appliances you retire from an appliance's page show up in this list." />
      ) : (
        <RetiredList
          today={today}
          rows={rows.map((r) => ({
            id: r.id,
            title: `${r.assetNumber} — ${r.applianceType.name}`,
            detail: [r.manufacturer, r.model].filter(Boolean).join(" ") || "No model entered",
            status: r.retiredPlan ? `${planChoiceLabel(r.retiredPlan.choice)}${r.retiredPlan.doneOn ? ` · done ${formatBusinessDate(r.retiredPlan.doneOn)}` : ""}` : "Decide later",
            bulkEligible: !!r.retiredPlan && !r.retiredPlan.doneOn && ["SCRAP", "DISPOSE", "OTHER"].includes(r.retiredPlan.choice),
          }))}
        />
      )}
      {rows.length >= listLimit && <p className="text-sm text-ink-soft">Showing the {listLimit} most recently changed.</p>}
      <ReminderSetting days={followUpDays} />
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
