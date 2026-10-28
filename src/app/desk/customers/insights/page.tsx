// AR-9 (INSIGHTS section 4): Customers › Insights — LD-4 lead insights,
// CU-3 customer insights and the Growth "worth a call" lists, where the
// owner works. OWNER/ADMIN only (the domain functions refuse everyone else
// too). Every figure's definition is one tap away (glossary InfoTips).
import Link from "next/link";
import { z } from "zod";
import { requireRole } from "@/lib/session";
import { formatMoney } from "@/lib/money-ui";
import { formatShortDate } from "@/lib/business-date";
import { getCustomerInsights, getLeadInsights, getWorthACall } from "@/domains/insights/customers";
import { MIN_LEADS, MIN_RENTALS } from "@/domains/insights/thresholds";
import { DataTable, EmptyState, InfoTip, MiniBars, ScreenHeader, StatStrip, type Column } from "@/components/kit";

export const metadata = { title: "Customers insights" };

const periodSchema = z.enum(["this", "last"]).catch("this");

function formatSpeed(minutes: number, aroundTheClock: boolean): string {
  if (minutes < 60) return `${minutes} min`;
  if (aroundTheClock && minutes >= 60 * 24) {
    const days = Math.round((minutes / (60 * 24)) * 10) / 10;
    return `${days} days`;
  }
  if (!aroundTheClock && minutes >= 480) {
    const days = Math.round((minutes / 480) * 10) / 10;
    return `${days} business days`;
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

function pct(rate: number | null): string {
  return rate === null ? "Not enough data yet" : `${Math.round(rate * 100)}%`;
}

export default async function CustomersInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; show?: string }>;
}) {
  await requireRole("OWNER", "ADMIN");
  const params = await searchParams;
  const period = periodSchema.parse(params.period);
  const now = new Date();
  const lastMonthAnchor = (() => {
    const d = new Date(now);
    d.setUTCDate(0); // last day of last month (UTC anchor is fine for month selection)
    return d;
  })();
  const [leads, customers, worth] = await Promise.all([
    getLeadInsights(now),
    getCustomerInsights(period === "last" ? lastMonthAnchor : now),
    getWorthACall(now),
  ]);
  const month = period === "last" ? leads.lastMonth : leads.thisMonth;
  const other = period === "last" ? leads.thisMonth : leads.lastMonth;
  const periodToggle = (
    <div className="flex gap-2 text-sm">
      <Link
        href="/desk/customers/insights?period=this"
        aria-current={period === "this" ? "page" : undefined}
        className={period === "this" ? "font-extrabold text-ink underline" : "font-bold text-primary hover:underline"}
      >
        This month
      </Link>
      <span aria-hidden="true" className="text-ink-soft">·</span>
      <Link
        href="/desk/customers/insights?period=last"
        aria-current={period === "last" ? "page" : undefined}
        className={period === "last" ? "font-extrabold text-ink underline" : "font-bold text-primary hover:underline"}
      >
        Last month
      </Link>
    </div>
  );

  const sourceColumns: Column<(typeof leads.bySource)[number]>[] = [
    { key: "source", header: "Source", cell: (r) => r.source },
    { key: "leads", header: "Leads", cell: (r) => String(r.leads) },
    { key: "won", header: "Won", cell: (r) => String(r.won) },
    { key: "winRate", header: "Win rate", cell: (r) => pct(r.winRate) },
  ];

  const callList = <T,>(
    key: string,
    title: string,
    rows: T[],
    columns: Column<T>[],
    emptyText: string,
    rowKey: (row: T) => string,
  ) => {
    const expanded = params.show === key;
    const shown = expanded ? rows : rows.slice(0, 10);
    return (
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-extrabold text-ink">{title} ({rows.length})</h3>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-soft">{emptyText}</p>
        ) : (
          <>
            <DataTable
              caption={title}
              rows={shown}
              rowKey={rowKey}
              columns={columns}
              mobileCard={(r) => (
                <div className="flex flex-col gap-1">
                  <div>{columns[0]!.cell(r)}</div>
                  <div className="text-sm text-ink-soft">{columns[1]!.cell(r)}</div>
                  <div>{columns[2]!.cell(r)}</div>
                </div>
              )}
              empty={<p className="text-sm text-ink-soft">{emptyText}</p>}
            />
            {!expanded && rows.length > 10 ? (
              <Link
                href={`/desk/customers/insights?period=${period}&show=${key}`}
                className="text-sm font-bold text-primary hover:underline"
              >
                Show all {rows.length}
              </Link>
            ) : null}
          </>
        )}
      </section>
    );
  };

  return (
    <div className="flex flex-col gap-8 px-1 sm:px-0">
      <ScreenHeader title="Customers" />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-base font-extrabold text-ink">
            Leads <InfoTip term="win-rate" />
          </h2>
          {periodToggle}
        </div>
        <StatStrip
          items={[
            { label: "New leads", value: String(month.newLeads), sub: `${period === "last" ? "This" : "Last"} month ${other.newLeads}` },
            {
              label: "Speed to lead",
              value: month.speedToLeadMedianMinutes === null ? "Not enough data yet" : formatSpeed(month.speedToLeadMedianMinutes, leads.aroundTheClock),
              info: "speed-to-lead",
              sub:
                month.speedToLeadMedianMinutes === null
                  ? `You have ${month.speedBaseCount} so far — check back after ${MIN_LEADS}.`
                  : leads.aroundTheClock
                    ? "Counted around the clock — your opening hours aren't set."
                    : leads.responseTargetDays === 0
                      ? "Your target: the same day"
                      : `Your target: within ${leads.responseTargetDays} days`,
            },
            {
              label: "Quote rate",
              value: pct(month.quoteRate),
              info: "quote-rate",
              sub: month.quoteRate === null ? `You have ${month.newLeads} so far — check back after ${MIN_LEADS}.` : `${month.quotedCount} of ${month.newLeads} quoted`,
            },
            {
              label: "Win rate",
              value: pct(month.winRate),
              info: "win-rate",
              sub: month.winRate === null ? `You have ${month.closedCount} closed so far — check back after ${MIN_LEADS}.` : `${month.wonCount} of ${month.closedCount} closed won`,
            },
          ]}
        />
        <p className="flex items-center gap-1.5 text-sm text-ink">
          Pipeline value <span className="font-extrabold">{formatMoney(leads.pipelineValueCents)}/mo</span>
          <InfoTip term="pipeline-value" />
        </p>

        <h3 className="text-sm font-extrabold text-ink">Where leads come from</h3>
        {leads.bySource.length === 0 ? (
          <EmptyState title="No leads yet — sources appear here once leads come in." />
        ) : (
          <DataTable
            caption="Where leads come from"
            rows={leads.bySource}
            rowKey={(r) => r.source}
            columns={sourceColumns}
            mobileCard={(r) => (
              <div className="flex items-start justify-between gap-3">
                <span className="font-bold text-ink">{r.source}</span>
                <span className="text-sm text-ink-soft">{r.leads} leads · {r.won} won · win rate {pct(r.winRate)}</span>
              </div>
            )}
            empty={<EmptyState title="No leads yet — sources appear here once leads come in." />}
          />
        )}

        <h3 className="text-sm font-extrabold text-ink">Why leads were lost (last 90 days)</h3>
        {leads.topLostReasons.length === 0 ? (
          <p className="text-sm text-ink-soft">No leads lost in the last 90 days.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {leads.topLostReasons.map((r) => (
              <li key={r.reason} className="flex justify-between gap-3">
                <span>{r.reason}</span>
                <span className="font-bold tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
        )}

        <h3 className="text-sm font-extrabold text-ink">Last 12 weeks</h3>
        <MiniBars
          labels={leads.trend.map((w) => formatShortDate(w.weekStart, now))}
          series={[
            { label: "New leads", values: leads.trend.map((w) => w.newLeads) },
            { label: "Won", values: leads.trend.map((w) => w.wonLeads) },
          ]}
          format={(v) => String(v)}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-1.5 text-base font-extrabold text-ink">
            Customers <InfoTip term="active-customers" />
          </h2>
          {periodToggle}
        </div>
        <StatStrip
          items={[
            {
              label: "Active customers",
              value: String(customers.activeNow),
              info: "active-customers",
              sub: `${customers.change >= 0 ? "+" : ""}${customers.change} this month`,
            },
            { label: "New this month", value: String(customers.newCustomers) },
            { label: "Left this month", value: String(customers.lostCustomers), info: "customers-left" },
            {
              label: "Average rent",
              value: customers.avgMonthlyRentCents === null ? "—" : `${formatMoney(customers.avgMonthlyRentCents)}/mo`,
              info: "average-rent",
            },
          ]}
        />
        {customers.whyLost.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {customers.whyLost.map((r) => (
              <li key={r.reason} className="flex justify-between gap-3">
                <span>{r.reason}</span>
                <span className="font-bold tabular-nums">{r.count}</span>
              </li>
            ))}
          </ul>
        ) : null}
        <dl className="flex flex-col gap-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5">Average time as a customer <InfoTip term="time-as-customer" /></dt>
            <dd className="font-bold">
              {customers.avgLifetimeMonths === null
                ? `Not enough data yet — you have ${customers.lifetimeBaseCount} so far, check back after ${MIN_RENTALS}.`
                : `${customers.avgLifetimeMonths} months`}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5">Collected per customer <InfoTip term="collected-per-customer" /></dt>
            <dd className="font-bold">
              {customers.avgCollectedPerCustomerCents === null
                ? `Not enough data yet — you have ${customers.collectedBaseCount} so far, check back after ${MIN_RENTALS}.`
                : formatMoney(customers.avgCollectedPerCustomerCents)}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5">On automatic payments <InfoTip term="automatic-payments-share" /></dt>
            <dd className="font-bold">{pct(customers.autopayShare)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="flex items-center gap-1.5">Behind on a bill now <InfoTip term="behind-on-a-bill" /></dt>
            <dd className="font-bold">{pct(customers.payingLateShare)}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Top cities</dt>
            <dd className="flex flex-wrap gap-1.5">
              {customers.topCities.length === 0 ? (
                <span className="text-ink-soft">No active rentals yet</span>
              ) : (
                customers.topCities.map((c) => (
                  <span key={c.city} className="rounded-full bg-subtle px-2.5 py-1 text-xs font-bold">
                    {c.city} · {c.count}
                  </span>
                ))
              )}
            </dd>
          </div>
        </dl>
      </section>

      <section className="flex flex-col gap-5">
        <h2 className="text-base font-extrabold text-ink">Worth a call</h2>
        {callList("churn", "Customers worth a call", worth.churnRisk, [
          {
            key: "name", header: "Customer",
            cell: (r) => <Link href={`/desk/customers/${r.customerId}`} className="font-bold hover:underline">{r.customerName}</Link>,
          },
          { key: "reason", header: "Why", cell: (r) => r.reasons.join(" · ") },
          {
            key: "call", header: "",
            cell: (r) => r.phone
              ? <a href={`tel:${r.phone}`} className="font-bold text-primary hover:underline">Call</a>
              : <Link href={`/desk/customers/${r.customerId}`} className="font-bold text-primary hover:underline">Open</Link>,
          },
        ], "No active rental currently meets the churn-risk rules.", (r) => r.agreementId)}
        {callList("winback", "Leads worth a follow-up", worth.winBack, [
          {
            key: "name", header: "Lead",
            cell: (r) => <Link href={`/desk/leads/${r.leadId}`} className="font-bold hover:underline">{r.contactName}{r.companyName ? ` — ${r.companyName}` : ""}</Link>,
          },
          { key: "reason", header: "Why", cell: (r) => r.reason },
          {
            key: "call", header: "",
            cell: (r) => r.phone
              ? <a href={`tel:${r.phone}`} className="font-bold text-primary hover:underline">Call</a>
              : <Link href={`/desk/leads/${r.leadId}`} className="font-bold text-primary hover:underline">Open</Link>,
          },
        ], "No lead currently meets the win-back rules.", (r) => r.leadId)}
        {callList("price", "Rentals due for a price review", worth.priceReview, [
          {
            key: "name", header: "Customer",
            cell: (r) => r.customerName,
          },
          { key: "why", header: "Why", cell: (r) => `Signed ${r.monthsAgo} months ago · ${formatMoney(r.monthlyTotalCents)}/mo` },
          {
            key: "open", header: "",
            cell: (r) => <Link href={`/desk/agreements/${r.agreementId}`} className="font-bold text-primary hover:underline">Open rental</Link>,
          },
        ], "No active rental currently meets the price-review rule.", (r) => r.agreementId)}
        {callList("review", "Good people to ask for a review or referral", worth.reviewCandidates, [
          {
            key: "name", header: "Customer",
            cell: (r) => r.customerName,
          },
          { key: "why", header: "Why", cell: () => "Billing cleanly for 90+ days with nothing past due" },
          {
            key: "open", header: "",
            cell: (r) => <Link href={`/desk/customers/${r.customerId}`} className="font-bold text-primary hover:underline">Open customer</Link>,
          },
        ], "Nobody currently meets the review-request rules.", (r) => r.agreementId)}
      </section>
    </div>
  );
}
