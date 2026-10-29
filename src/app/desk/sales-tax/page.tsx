import Link from "next/link";
import { requireRole } from "@/lib/session";
import {
  getTaxWorkspaceOverview, includeTodayTaxAttention, type TaxAttentionKind,
} from "@/domains/tax/workspace-overview";
import { getExceptionOverview } from "@/domains/exceptions";
import { syncComplianceFilings } from "@/domains/compliance/filings";
import { BudgetContextCard } from "@/domains/budget/context";
import { listDecisions } from "@/domains/decisions";
import { prisma } from "@/lib/prisma";
import { InboxCard, InfoTip, ScreenHeader, StatStrip, TaskCard } from "@/components/kit";
import type { Tone } from "@/components/kit";

const label: Record<TaxAttentionKind, string> = {
  OVERDUE: "Past due", AMENDMENT: "Amendment", DUE: "Due soon",
  NOT_READY: "Filing not ready", SETUP: "Setup", INFO: "Review",
};
const tone: Record<TaxAttentionKind, Tone> = {
  OVERDUE: "danger", AMENDMENT: "attention", DUE: "attention",
  NOT_READY: "attention", SETUP: "info", INFO: "neutral",
};
const day = (d: Date) => d.toISOString().slice(0, 10);

export default async function SalesTaxRootPage() {
  const actor = await requireRole("OWNER", "ADMIN", "ACCOUNTANT");
  // CMP-1: this page shows Today attention too — keep the filing rows fresh,
  // and never let a sync failure take the Taxes home down.
  await syncComplianceFilings().catch(() => undefined);
  const [projection, inbox, settings] = await Promise.all([
    getTaxWorkspaceOverview(actor.user.id), getExceptionOverview(),
    prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { cashBudgetEnabled: true },
    }),
  ]);
  const overview = includeTodayTaxAttention(projection, inbox.items);
  // DEC-1: tax decisions still on a starting value (not CONFIRMED) are "open".
  // A decisions read must never take the overview down — omit the stat instead.
  const decisionsOpen = await listDecisions(actor.user.id, { area: "TAX" })
    .then((cards) => cards.filter((card) => card.state !== "CONFIRMED").length)
    .catch(() => null);
  return <div className="space-y-8">
    <div className="flex items-start gap-1.5">
      <ScreenHeader title="Taxes" />
      <span className="pt-1.5"><InfoTip term="taxes-overview" /></span>
    </div>
    <StatStrip
      items={[
        {
          label: "Next return due",
          value: overview.nextReturn ? day(overview.nextReturn.dueOn) : "None scheduled",
          tone: overview.nextReturn ? undefined : "attention",
        },
        ...(decisionsOpen !== null
          ? [{ label: "Decisions open", value: String(decisionsOpen), tone: decisionsOpen > 0 ? "attention" as const : undefined }]
          : []),
      ]}
    />
    {decisionsOpen !== null && (
      <p className="-mt-4 text-sm">
        <Link className="font-medium underline" href="/desk/settings/decisions">Open Decisions &amp; reviews</Link>
        {" "}to answer the tax questions still on starting values.
      </p>
    )}
    <section id="tax-attention" className="flex flex-col gap-3">
      <h2 className="text-base font-extrabold text-ink">Needs your attention</h2>
      {overview.attention.map(item => (
        <InboxCard
          key={item.id}
          eyebrow={label[item.kind]}
          eyebrowTone={tone[item.kind]}
          title={item.title}
          detail={item.detail}
          severity={item.kind === "OVERDUE" ? "high" : "normal"}
          actions={[{ kind: "link", label: "Resolve or review", href: item.href }]}
        />
      ))}
      {!overview.attention.length && (
        <p className="text-sm text-muted-foreground">
          No current tax attention items. Continue to verify official filing obligations.
        </p>
      )}
      {actor.user.role !== "ACCOUNTANT" && (
        <p className="text-sm text-muted-foreground">
          This is a bounded summary. <Link href="/desk/today" className="underline">See the complete Today inbox</Link>
          {" "}for additional tax, refund, invoice and rate-review work.
        </p>
      )}
    </section>
    {settings?.cashBudgetEnabled && (
      <BudgetContextCard userId={actor.user.id} heading="Protected tax obligations and budget"/>
    )}
    <section className="space-y-3">
      <h2 className="text-base font-extrabold text-ink">Next return</h2>
      {overview.nextReturn ? <div className="rounded-lg border border-border bg-card p-4">
        <p className="font-semibold">{overview.nextReturn.name} — {overview.nextReturn.kind.replaceAll("_", " ")}</p>
        <p className="text-sm text-muted-foreground">Filing period ends {day(overview.nextReturn.periodEnd)}
          {" · "}Legal due date {day(overview.nextReturn.dueOn)}</p>
        <Link className="text-sm underline" href={overview.nextReturn.href}>Open guided filing</Link>
      </div> : <p className="text-sm text-muted-foreground">
        No open scheduled returns. Check the account start dates and filing calendar before assuming nothing is owed.
      </p>}
      <Link className="text-sm underline" href="/desk/sales-tax/returns">All returns and filing history</Link>
    </section>
    <section className="space-y-3">
      <h2 className="text-base font-extrabold text-ink">Setup and verification</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {overview.setup.map(step => (
          <TaskCard
            key={step.key}
            title={step.title}
            href={step.href}
            info={step.detail}
            status={step.complete
              ? { label: "Recorded", tone: "good" }
              : { label: "Action needed", tone: "attention" }}
          />
        ))}
      </div>
    </section>
    <section className="space-y-3">
      <h2 className="text-base font-extrabold text-ink">Upcoming deadlines</h2>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {overview.nextDue.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-3 p-3 text-sm">
          <div><span className="font-semibold">{item.name}</span>
            <span className="text-muted-foreground"> · Due {day(item.dueOn)}</span></div>
          <Link href={item.href} className="underline">Open return</Link>
        </li>)}
        {!overview.nextDue.length && <li className="p-3 text-sm text-muted-foreground">No active open periods with a configured return.</li>}
      </ul>
    </section>
    <section className="space-y-3">
      <h2 className="text-base font-extrabold text-ink">Beyond sales tax</h2>
      <div className="rounded-lg border border-border bg-card p-4 space-y-2">
        <p className="font-semibold">Compliance — income tax, 1099s, licenses and the rest</p>
        <p className="text-sm text-muted-foreground">
          Every federal, Colorado and city obligation that is not sales tax, with its dates and sources.
          Nothing is filed without your approval.
        </p>
        <Link href="/desk/compliance" className="text-sm font-medium underline">Open Compliance</Link>
      </div>
    </section>
  </div>;
}
