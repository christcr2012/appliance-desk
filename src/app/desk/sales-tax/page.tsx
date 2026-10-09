import Link from "next/link";
import { requireRole } from "@/lib/session";
import {
  getTaxWorkspaceOverview, includeTodayTaxAttention, type TaxAttentionKind,
} from "@/domains/tax/workspace-overview";
import { getExceptionOverview } from "@/domains/exceptions";

const label: Record<TaxAttentionKind, string> = {
  OVERDUE: "Past due", AMENDMENT: "Amendment", DUE: "Due soon",
  NOT_READY: "Filing not ready", SETUP: "Setup", INFO: "Review",
};
export default async function SalesTaxRootPage() {
  const actor = await requireRole("OWNER", "ADMIN");
  const [projection, inbox] = await Promise.all([
    getTaxWorkspaceOverview(actor.user.id), getExceptionOverview(),
  ]);
  const overview = includeTodayTaxAttention(projection, inbox.items);
  return <main className="space-y-8">
    <section className="space-y-2">
      <h2 className="text-xl font-semibold">Tax overview</h2>
      <p className="text-sm text-muted-foreground">
        Your Colorado filing setup, upcoming returns and tax decisions in one place.
        Filing, reconciliation and payment remain separate owner-controlled actions.
      </p>
    </section>
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Setup and verification</h3>
      <ul className="grid gap-3 sm:grid-cols-2">
        {overview.setup.map(step => <li key={step.key} className="space-y-2 rounded-lg border border-border bg-card p-4">
          <p className="font-semibold">{step.complete ? "Recorded" : "Action needed"}: {step.title}</p>
          <p className="text-sm text-muted-foreground">{step.detail}</p>
          <Link href={step.href} className="text-sm font-medium underline">Review {step.title.toLowerCase()}</Link>
        </li>)}
      </ul>
    </section>
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Next return</h3>
      {overview.nextReturn ? <div className="rounded-lg border border-border bg-card p-4">
        <p className="font-semibold">{overview.nextReturn.name} — {overview.nextReturn.kind.replaceAll("_", " ")}</p>
        <p className="text-sm text-muted-foreground">Filing period ends {overview.nextReturn.periodEnd.toISOString().slice(0, 10)}
          {" · "}Legal due date {overview.nextReturn.dueOn.toISOString().slice(0, 10)}</p>
        <Link className="text-sm underline" href={overview.nextReturn.href}>Open guided filing</Link>
      </div> : <p className="text-sm text-muted-foreground">
        No open scheduled returns. Check the account start dates and filing calendar before assuming nothing is owed.
      </p>}
      <Link className="text-sm underline" href="/desk/sales-tax/returns">All returns and filing history</Link>
    </section>
    <section id="tax-attention" className="space-y-3">
      <h3 className="text-lg font-semibold">Tax attention</h3>
      <p className="text-sm text-muted-foreground">
        Ordered by overdue, amendments, due, not-ready, setup and information.
        This includes tax work surfaced on Today, not just filing dates and setup.
        These notices do not post tax charges or collect money.
      </p>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {overview.attention.map(item => <li key={item.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{label[item.kind]} — {item.title}</p>
            <p className="text-sm text-muted-foreground">{item.detail}</p>
          </div>
          <Link className="self-start whitespace-nowrap text-sm underline" href={item.href}>Resolve or review</Link>
        </li>)}
        {!overview.attention.length && <li className="p-4 text-sm text-muted-foreground">
          No current tax attention items. Continue to verify official filing obligations.
        </li>}
      </ul>
      <p className="text-sm text-muted-foreground">
        This is a bounded summary. <Link href="/desk/today" className="underline">See the complete Today inbox</Link>
        {" "}for additional tax, refund, invoice and rate-review work.
      </p>
    </section>
    <section className="space-y-3">
      <h3 className="text-lg font-semibold">Upcoming deadlines</h3>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {overview.nextDue.map(item => <li key={item.id} className="flex flex-wrap justify-between gap-3 p-3 text-sm">
          <div><span className="font-semibold">{item.name}</span>
            <span className="text-muted-foreground"> · Due {item.dueOn.toISOString().slice(0, 10)}</span></div>
          <Link href={item.href} className="underline">Open return</Link>
        </li>)}
        {!overview.nextDue.length && <li className="p-3 text-sm text-muted-foreground">No active open periods with a configured return.</li>}
      </ul>
    </section>
  </main>;
}
