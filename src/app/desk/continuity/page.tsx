import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { formatMoney } from "@/lib/money-ui";
import { loadContinuity } from "@/domains/continuity/reads";
import { CHARGE_PAUSE_RULE_KEYS, PROFILE_FIELDS } from "@/domains/continuity/rules";
import { pauseChargesAction, saveProfileAction } from "./actions";
import { ContinuityForm, Field } from "./forms";

export const metadata = { title: "If something happens to me" };
const fmt = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
const JOB_LABELS: Record<string, string> = { DELIVERY: "Delivery", INSTALLATION: "Installation", SWAP: "Swap", MAINTENANCE_VISIT: "Maintenance visit", REMOVAL: "Pickup" };

export default async function ContinuityPage() {
  await requireRole("OWNER");
  const c = await loadContinuity(new Date());
  const pauseAction = pauseChargesAction.bind(null, true);
  const resumeAction = pauseChargesAction.bind(null, false);
  return (
    <div className="space-y-6">
      <PageHeader title="If something happens to me" />
      <p className="text-sm text-ink-soft">
        One place a trusted person could use to keep Robinson Appliance Rentals running if you were suddenly unavailable. Everything below is filled in from the live app, except the contacts you type.
        The yearly check-up is <Link className="underline" href="/desk/continuity/checkup">here</Link>.
      </p>
      {c.gaps.length > 0 ? (
        <p role="status" className="rounded-control border border-line bg-surface-soft p-3 text-sm">Still missing: {c.gaps.join(", ")}.</p>
      ) : null}

      <Card title="Right now (live)">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{c.live.appliancesOut} appliance{c.live.appliancesOut === 1 ? " is" : "s are"} out with customers, on {c.live.activeAgreements} active rental agreement{c.live.activeAgreements === 1 ? "" : "s"}.</li>
          <li>{c.live.openInvoiceCount} unpaid bill{c.live.openInvoiceCount === 1 ? "" : "s"}, {formatMoney(c.live.openBalanceCents)} still owed in total.</li>
          <li>{c.live.upcomingJobs} visit{c.live.upcomingJobs === 1 ? "" : "s"} scheduled in the next 14 days{c.live.upcomingJobs > 10 ? " (first 10 shown)" : ""}.</li>
        </ul>
        {c.live.nextJobs.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {c.live.nextJobs.map((j) => <li key={j.id}><Link className="underline" href={`/desk/jobs/${j.id}`}>{JOB_LABELS[j.type] ?? j.type}</Link> — {fmt(j.when)}</li>)}
          </ul>
        ) : null}
        <p className="mt-2 text-sm">Open the <Link className="underline" href="/desk/dispatch">schedule</Link>, <Link className="underline" href="/desk/billing">billing</Link> or <Link className="underline" href="/desk/fleet">appliances</Link> for the details.</p>
      </Card>

      <Card title="Pause all automatic charges">
        <p className="mb-3 text-sm">
          One switch for an emergency. While it is on, the nightly jobs that start new charges, add late fees, send past-due notices or email customers reminders do not run ({CHARGE_PAUSE_RULE_KEYS.length} jobs).
          It never refunds, cancels or changes a bill, and a customer can still pay on their own. Backups and payment checking keep running. Only the owner can use it, and each press is written to the Activity log.
        </p>
        {c.paused ? (
          <div className="space-y-3">
            <p role="status" className="text-sm font-semibold">Paused since {fmt(c.paused.since)}{c.paused.note ? ` — ${c.paused.note}` : ""}.</p>
            <ContinuityForm action={resumeAction} submit="Turn automatic charges back on" />
          </div>
        ) : (
          <ContinuityForm action={pauseAction} submit="Pause all automatic charges" danger>
            <Field label="Why (optional)" name="note" hint="For example: out of town, family emergency." />
          </ContinuityForm>
        )}
      </Card>

      <Card title="People and places">
        <ContinuityForm action={saveProfileAction} submit="Save">
          <div className="grid gap-3 md:grid-cols-2">
            {PROFILE_FIELDS.map((f) => (
              <Field key={f.key} label={f.label} name={f.key} defaultValue={c.profile[f.key]} wide={f.key === "continuityRecordsNote"}
                hint={f.key === "continuityRecordsNote" ? "Say where, never the passwords themselves. For example: 'password manager, emergency sheet in the safe'." : undefined} />
            ))}
          </div>
        </ContinuityForm>
        {c.reviewedAt ? <p className="mt-2 text-xs text-ink-soft">Last saved {fmt(c.reviewedAt)}.</p> : null}
      </Card>

      <Card title="Questions for your attorney">
        <p className="text-sm">
          Does your LLC&apos;s operating agreement name a successor member? In Colorado an LLC with no members is dissolved 91 days later unless a member is admitted (C.R.S. 7-80-801). This is filed as a question in the Decisions list for your attorney; the app does not give legal advice.
        </p>
      </Card>
    </div>
  );
}
