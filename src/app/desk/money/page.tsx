// AR-3 (MONEY-AREA 2): Money › Overview — the area's front page. Every number comes from
// getMoneyOverview, which reuses the revenue dashboard's own rules, so the two can never disagree.
import Link from "next/link";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import { getMoneyOverview } from "@/domains/billing/money-overview";
import { getPayments } from "@/domains/billing/payments-list";
import { paymentMethodWord, paymentPill } from "@/domains/billing/payment-tabs";
import { getExceptionOverview } from "@/domains/exceptions";
import { INBOX_GROUP, inboxActions, inboxEyebrow, inboxEyebrowTone } from "@/domains/exceptions/inbox";
import { InboxCard, NextStepCard, ScreenHeader, StatStrip, StatusPill, type MenuItem } from "@/components/kit";

export const metadata = { title: "Money" };

const OVERFLOW: MenuItem[] = [
  { kind: "link", label: "Rental income details", href: "/desk/revenue" },
  { kind: "link", label: "Reports", href: "/desk/reports" },
  { kind: "link", label: "Check against Stripe", href: "/desk/billing/reconciliation" },
];

export default async function MoneyOverviewPage() {
  await requireRole("OWNER", "ADMIN");
  const now = new Date();
  const [overview, exceptions, recent] = await Promise.all([
    getMoneyOverview(now),
    getExceptionOverview(),
    getPayments({ status: "received", sort: "newest", pageSize: 5 }, now),
  ]);
  const decisions = exceptions.items.filter((item) => INBOX_GROUP[item.category] === "money").slice(0, 10);

  return (
    <div className="flex flex-col gap-6">
      <ScreenHeader title="Money" overflow={OVERFLOW} />
      <StatStrip
        items={[
          {
            label: "Money in this month",
            value: formatMoney(overview.collectedThisMonthCents),
            sub: `Last month ${formatMoney(overview.collectedLastMonthCents)}`,
          },
          { label: "Still owed", value: `${formatMoney(overview.owedNowCents)} · ${overview.openBillCount} bills` },
          {
            label: "Past due",
            value: formatMoney(overview.pastDueCents),
            tone: overview.pastDueCents > 0 ? "attention" : undefined,
          },
          { label: "Coming in 30 days", value: formatMoney(overview.expectedNext30Cents), info: "expected-30" },
        ]}
      />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold text-ink">Needs a decision</h2>
        {decisions.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing needs a decision.</p>
        ) : (
          <>
            {decisions.map((item) => {
              const { actions, overflow } = inboxActions(item);
              return (
                <InboxCard
                  key={item.todoKey ?? `${item.href}-${item.title}`}
                  eyebrow={inboxEyebrow(item, now)}
                  eyebrowTone={inboxEyebrowTone(item)}
                  title={item.title}
                  detail={item.detail}
                  actions={actions}
                  overflow={overflow}
                  severity={item.severity === "high" ? "high" : "normal"}
                />
              );
            })}
            {decisions.length >= 10 ? (
              <Link href="/desk/today?group=money" className="text-sm font-bold text-primary hover:underline">
                See all on Today
              </Link>
            ) : null}
          </>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-extrabold text-ink">Recent payments</h2>
        {recent.rows.length === 0 ? (
          <p className="text-sm text-ink-soft">No payments yet</p>
        ) : (
          <>
            <ul className="flex flex-col gap-2">
              {recent.rows.map((row) => {
                const pill = paymentPill(row.status);
                return (
                  <li key={row.id} className="flex items-center gap-3 rounded-card bg-surface px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/desk/billing/customer/${row.customerId}/invoice/${row.invoiceId}`}
                        className="font-bold text-ink hover:underline"
                      >
                        {row.customerName}
                      </Link>
                      <p className="text-sm text-ink-soft">
                        {paymentMethodWord(row.method)} · {formatShortDate(row.createdAt, now)}
                      </p>
                    </div>
                    <span className="font-extrabold text-ink tabular-nums">{formatMoney(row.amountCents)}</span>
                    <StatusPill label={pill.label} tone={pill.tone} info={pill.info} />
                  </li>
                );
              })}
            </ul>
            <Link href="/desk/payments" className="text-sm font-bold text-primary hover:underline">
              All payments
            </Link>
          </>
        )}
      </section>

      {overview.failedThisMonth > 0 ? (
        <NextStepCard
          title={`${overview.failedThisMonth} card payments failed this month`}
          tone="attention"
          actions={[{ kind: "link", label: "See failed payments", href: "/desk/payments?status=failed", primary: true }]}
        />
      ) : null}
    </div>
  );
}
