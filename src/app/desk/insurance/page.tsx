import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { businessDateKey } from "@/lib/business-date";
import { formatMoney, moneyInputValue } from "@/lib/money-ui";
import { loadInsuranceOverview } from "@/domains/insurance/reads";
import { INSURANCE_KINDS, KIND_HELP, KIND_LABELS, REMIND_FIRST_DEFAULT, REMIND_SECOND_DEFAULT, workersCompSummary, type RenewalState } from "@/domains/insurance/rules";
import { archivePolicyAction, certificateAction, keepCertificateAction, remindersAction, savePolicyAction, workersCompAction } from "./actions";
import { Field, InsuranceForm, Select } from "./forms";

export const metadata = { title: "Insurance" };

const dateText = (d: Date | null) => d ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(d) : "—";
const kindOptions = INSURANCE_KINDS.map((k) => [k, KIND_LABELS[k]] as [string, string]);

function stateText(s: RenewalState): string {
  if (s.kind === "expired") return `Ended ${s.daysOver} day${s.daysOver === 1 ? "" : "s"} ago`;
  if (s.kind === "ok") return `Ends in ${s.daysLeft} days`;
  return `Ends in ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} — renew soon`;
}

function PolicyFields({ p }: { p?: { kind: string; insurer: string; policyNumber: string; limitsText: string | null; annualPremiumCents: number | null; effectiveOn: Date | null; expiresOn: Date; agentName: string | null; agentEmail: string | null; certificateNote: string | null; notes: string | null } }) {
  const key = (d: Date | null | undefined) => d ? businessDateKey(d) : "";
  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Select label="Kind of insurance" name="kind" defaultValue={p?.kind ?? "GENERAL_LIABILITY"} options={kindOptions} />
      <Field label="Insurance company" name="insurer" required defaultValue={p?.insurer} />
      <Field label="Policy number" name="policyNumber" required defaultValue={p?.policyNumber} />
      <Field label="Limits (as your agent wrote them)" name="limits" defaultValue={p?.limitsText ?? ""} hint="For example: $1,000,000 per claim. Ask your agent what limits fit; the app doesn't suggest amounts." />
      <Field label="Yearly cost (dollars)" name="premium" defaultValue={p?.annualPremiumCents != null ? moneyInputValue(p.annualPremiumCents) : ""} />
      <Field label="Starts" name="effectiveOn" type="date" defaultValue={key(p?.effectiveOn)} />
      <Field label="Ends (renewal date)" name="expiresOn" type="date" required defaultValue={key(p?.expiresOn)} />
      <Field label="Agent's name" name="agentName" defaultValue={p?.agentName ?? ""} />
      <Field label="Agent's email" name="agentEmail" type="email" defaultValue={p?.agentEmail ?? ""} />
      <Field label="Where the certificate is kept" name="certificateNote" defaultValue={p?.certificateNote ?? ""} hint="For example: PDF in the Insurance folder in Drive." />
      <Field label="Notes" name="notes" defaultValue={p?.notes ?? ""} />
    </div>
  );
}

export default async function InsurancePage() {
  await requireRole("OWNER");
  const now = new Date();
  const o = await loadInsuranceOverview(now);
  const current = o.policies.filter((p) => !p.archivedAt);
  const old = o.policies.filter((p) => p.archivedAt);
  const s = o.settings;
  return (
    <div className="space-y-6">
      <PageHeader title="Insurance" />
      <p className="text-sm text-ink-soft">
        Your policies in one place, with a reminder on your To do list before each one ends. The app never picks coverage amounts for you: ask your insurance agent, and write down what they say. Your Business paperwork checklist also lists insurance; mark those items done once the policies are here.
        See <Link className="underline" href="/desk/paperwork">Business paperwork</Link>.
      </p>

      <Card title="Your policies">
        {current.length === 0 ? <p className="text-sm">No policies yet. Add the ones you have below.</p> : (
          <ul className="space-y-4">
            {current.map((p) => (
              <li key={p.id} className="rounded-control border border-line p-3">
                <p className="font-semibold">{KIND_LABELS[p.kind]} — {p.insurer}</p>
                <p className="text-sm">Policy {p.policyNumber} · ends {dateText(p.expiresOn)} · <span className={p.state.kind === "ok" ? "" : "font-semibold"}>{stateText(p.state)}</span></p>
                <p className="text-sm text-ink-soft">{p.limitsText ? `Limits: ${p.limitsText}. ` : "Limits not written down yet — ask your agent. "}{p.annualPremiumCents != null ? `About ${formatMoney(p.annualPremiumCents)} a year.` : ""}</p>
                <p className="mt-1 text-xs text-ink-soft">{KIND_HELP[p.kind]}</p>
                <div className="mt-2 text-sm">
                  {p.record ? (
                    <p>
                      Certificate: {p.record.recordFiles.length > 0 ? `${p.record.recordFiles[0].fileName}${p.record.recordFiles.length > 1 ? ` and ${p.record.recordFiles.length - 1} older file${p.record.recordFiles.length === 2 ? "" : "s"}` : ""}, kept privately` : "no file uploaded yet"}.{" "}
                      <Link className="underline" href={`/desk/paperwork/${p.record.id}`}>Open the certificate record</Link> to {p.record.recordFiles.length > 0 ? "add a newer file" : "upload the PDF"}. Its end date and yearly cost follow this policy.
                    </p>
                  ) : (
                    <InsuranceForm action={keepCertificateAction.bind(null, p.id)} submit="Keep the certificate PDF with my business records" secondary />
                  )}
                </div>
                <details className="mt-3">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Change this policy</summary>
                  <InsuranceForm action={savePolicyAction.bind(null, p.id)} submit="Save changes"><PolicyFields p={p} /></InsuranceForm>
                </details>
                <details className="mt-1">
                  <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">Request a certificate of insurance</summary>
                  <p className="mb-2 text-sm text-ink-soft">For a property manager who needs proof of insurance. This writes the email to your agent for you to read and send. Nothing is sent by the app.</p>
                  <InsuranceForm action={certificateAction.bind(null, p.id)} submit="Write the email">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Who is asking" name="requesterName" required />
                      <Field label="Their company" name="requesterCompany" />
                      <Field label="Send the certificate to (email)" name="requesterEmail" type="email" required />
                      <Field label="Certificate holder wording they asked for" name="holderText" />
                    </div>
                  </InsuranceForm>
                </details>
                <form action={archivePolicyAction.bind(null, p.id, true)} className="mt-1"><button type="submit" className="min-h-11 text-sm underline">Move to old policies</button></form>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Add a policy">
        <InsuranceForm action={savePolicyAction.bind(null, null)} submit="Add policy"><PolicyFields /></InsuranceForm>
      </Card>

      <Card title="Workers' compensation" description="Required in Colorado once you have employees.">
        <div id="workers-comp" className="space-y-3">
          <p className="text-sm">{workersCompSummary({ status: s.workersCompStatus, note: s.workersCompNote, formSentOnText: s.workersCompFormSentOn ? dateText(s.workersCompFormSentOn) : null, mailNumber: s.workersCompMailNumber })}</p>
          {o.workersCompRequired ? <p role="status" className="text-sm font-semibold">Workers&apos; compensation insurance is required now: you have employees. Add the policy above as &ldquo;Workers&apos; compensation&rdquo; and set the status to &ldquo;A policy is in place&rdquo;.</p> : null}
          <p className="text-sm text-ink-soft">An LLC member who owns at least 10% may be able to opt out of coverage for themselves; the common way is a written rejection kept on file. Ask your agent or attorney. Starting value: not recorded — not confirmed.</p>
          <InsuranceForm action={workersCompAction} submit="Save">
            <div className="grid gap-3 md:grid-cols-2">
              <Select label="Status" name="status" defaultValue={s.workersCompStatus} options={[["NOT_SET", "Not recorded yet"], ["NO_EMPLOYEES_REJECTED", "No employees; coverage rejected as an LLC member"], ["POLICY_IN_PLACE", "A policy is in place"]]} />
              <Field label="Employees (not counting you)" name="employees" type="number" min={0} max={1000} defaultValue={s.workersCompEmployees} hint="Raise this when you hire someone, and a To do appears if no policy is recorded." />
              <Field label="Rejection form sent on" name="formSentOn" type="date" defaultValue={s.workersCompFormSentOn ? businessDateKey(s.workersCompFormSentOn) : ""} />
              <Field label="Certified mail number" name="mailNumber" defaultValue={s.workersCompMailNumber ?? ""} />
              <Field label="Note" name="note" defaultValue={s.workersCompNote ?? ""} />
            </div>
          </InsuranceForm>
        </div>
      </Card>

      <Card title="When to remind you" description="Days before a policy ends.">
        <p className="mb-2 text-sm text-ink-soft">Starting values — not confirmed: {REMIND_FIRST_DEFAULT} days and {REMIND_SECOND_DEFAULT} days, so you have time to compare quotes.</p>
        <InsuranceForm action={remindersAction} submit="Save" secondary restore="Restore recommended">
          <div className="grid gap-3 md:max-w-sm">
            <Field label="First reminder" name="first" type="number" min={1} max={365} defaultValue={s.insuranceRemindFirstDays} />
            <Field label="Second reminder" name="second" type="number" min={1} max={365} defaultValue={s.insuranceRemindSecondDays} />
          </div>
        </InsuranceForm>
      </Card>

      {o.requests.length > 0 ? (
        <Card title="Certificates you asked for">
          <ul className="space-y-1 text-sm">
            {o.requests.map((r) => <li key={r.id}>{dateText(r.requestedAt)} — {r.requesterName}{r.requesterCompany ? `, ${r.requesterCompany}` : ""} ({KIND_LABELS[r.policy.kind]}, {r.policy.insurer})</li>)}
          </ul>
        </Card>
      ) : null}

      {old.length > 0 ? (
        <Card title="Old policies">
          <ul className="space-y-2 text-sm">
            {old.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{KIND_LABELS[p.kind]} — {p.insurer}, policy {p.policyNumber}, ended {dateText(p.expiresOn)}</span>
                <form action={archivePolicyAction.bind(null, p.id, false)}><button type="submit" className="min-h-11 text-sm underline">Bring back</button></form>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
