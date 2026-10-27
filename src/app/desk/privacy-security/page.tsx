import Link from "next/link";
import { requireRole } from "@/lib/session";
import { Card, PageHeader } from "@/components/ui";
import { businessDateKey } from "@/lib/business-date";
import { loadPrivacyOverview } from "@/domains/security/reads";
import { FACE_MATCH_POLICY_NOTE } from "@/domains/security/rules";
import {
  addVendorAction, closeIncidentAction, complaintAction, complaintResolvedAction, determineIncidentAction,
  legalHoldAction, openIncidentAction, settingsAction, stepDoneAction, vendorReviewedAction,
} from "./actions";
import { Check, Field, SecurityForm, TextArea } from "./forms";

export const metadata = { title: "Privacy and security" };

const dateText = (d: Date | null) => d ? new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", month: "short", day: "numeric", year: "numeric" }).format(d) : "not yet";
const hourLabel = (h: number) => `${((h + 11) % 12) + 1}:00 ${h < 12 ? "am" : "pm"}`;

export default async function SecurityPage() {
  const session = await requireRole("OWNER", "ADMIN");
  const isOwner = session.user.role === "OWNER";
  const now = new Date();
  const today = businessDateKey(now);
  const overview = await loadPrivacyOverview(now);
  const s = overview.settings;
  const open = overview.incidents.filter((i) => i.state === "OPEN");
  const closed = overview.incidents.filter((i) => i.state === "CLOSED");
  return (
    <div className="space-y-6">
      <PageHeader title="Privacy and security" />
      <p className="text-sm text-ink-soft">
        The duties that come with holding customer information. The starting values below come from Colorado law and common practice for a small business, and are marked <strong>not confirmed</strong> until you or your lawyer confirm them (see Decisions &amp; reviews). The public page{" "}
        <Link className="underline" href="/privacy/how-we-handle-your-information">How we handle your information</Link> shows customers your written disposal policy.
      </p>

      <Card title="Something may have leaked">
        {isOwner ? (
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">
              If customer information may have been seen by someone who should not have seen it, record it here. Colorado gives you {overview.rules.noticeDays} days from the day you decide it really was exposed
              (starting value, not confirmed). If {overview.rules.agThreshold} or more Colorado residents are affected the Attorney General must be told too, and if more than {overview.rules.bureauThreshold} the credit bureaus. The app works out the dates and puts each step on your To do list. It never sends anything for you.
            </p>
            {open.map((incident) => (
              <div key={incident.id} className="space-y-3 rounded-control border border-line p-3">
                <p className="font-semibold">Found out {dateText(incident.discoveredAt)}: {incident.summary}</p>
                {!incident.determinedAt ? (
                  <div className="space-y-4">
                  <SecurityForm action={determineIncidentAction.bind(null, incident.id)} submit="Start the clock">
                    <p className="text-sm">Was information really exposed? When you decide yes, enter that date and the number of Colorado residents affected.</p>
                    <Field label="Date you decided" name="determinedOn" type="date" defaultValue={today} />
                    <Field label="Colorado residents affected" name="residents" type="number" min={0} max={10000000} defaultValue={0} />
                  </SecurityForm>

                  <SecurityForm action={closeIncidentAction.bind(null, incident.id)} submit="It was a false alarm — close it" secondary>
                    <TextArea label="What you checked and why nothing was exposed" name="note" />
                  </SecurityForm>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm">Decided {dateText(incident.determinedAt)}; {incident.residentsAffected} Colorado resident{incident.residentsAffected === 1 ? "" : "s"} affected.</p>
                    <ul className="space-y-3">
                      {incident.steps.map((step) => (
                        <li key={step.key} className="space-y-2">
                          <p className="text-sm font-medium">{step.done ? "Done" : "To do"}: {step.label}{step.due ? ` — by ${dateText(step.due)}` : ""}</p>
                          {!step.done && step.key !== "DETERMINE" ? (
                            <SecurityForm action={stepDoneAction.bind(null, incident.id, step.key)} submit="I did this" secondary>
                              <Field label="Date done" name="doneOn" type="date" defaultValue={today} />
                            </SecurityForm>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    <a className="inline-block min-h-11 text-sm font-semibold underline" href={`/desk/privacy-security/incident/${incident.id}/letter`} target="_blank" rel="noopener noreferrer">Open the notice letter for affected people (PDF)</a>
                    <SecurityForm action={closeIncidentAction.bind(null, incident.id)} submit="Close this incident" secondary>
                      <TextArea label="What was found and what was fixed" name="note" />
                    </SecurityForm>
                  </div>
                )}
              </div>
            ))}
            <SecurityForm action={openIncidentAction} submit="Record a possible leak">
              <TextArea label="What happened, or what did you notice?" name="summary" />
              <Field label="Date you found out" name="discoveredOn" type="date" defaultValue={today} />
            </SecurityForm>
            {closed.length > 0 ? (
              <details>
                <summary className="min-h-11 cursor-pointer text-sm font-medium">Closed incidents ({closed.length})</summary>
                <ul className="mt-2 space-y-1 text-sm">{closed.map((i) => <li key={i.id}>{dateText(i.discoveredAt)}: {i.summary} — closed {dateText(i.closedAt)}</li>)}</ul>
              </details>
            ) : null}
          </div>
        ) : <p className="text-sm text-ink-soft">Only the owner records and works a security incident.</p>}
      </Card>

      <Card title="Service providers that hold customer information">
        <div id="providers" className="space-y-4">
          <p className="text-sm text-ink-soft">Colorado asks you to make sure the companies you use keep information safe. Once a year ({s.vendorReviewMonths} months, your setting), open each provider&apos;s security page, read it, and record the date.</p>
          <ul className="space-y-4">
            {overview.vendors.map((v) => (
              <li key={v.id} className="space-y-2 border-b border-line pb-4 last:border-0">
                <p className="font-semibold">{v.name} — {v.whatTheyDo}</p>
                <p className="text-sm text-ink-soft">Holds: {v.dataTheyHold}</p>
                <p className="text-sm">Security terms reviewed: {v.termsReviewedOn ? dateText(v.termsReviewedOn) : "not yet"}{v.due ? " — due now" : ""}</p>
                <SecurityForm action={vendorReviewedAction.bind(null, v.id)} submit="I reviewed it" secondary>
                  <Field label="Date reviewed" name="reviewedOn" type="date" defaultValue={today} />
                  <Field label="Notes (optional)" name="notes" required={false} max={500} />
                </SecurityForm>
              </li>
            ))}
          </ul>
          {isOwner ? (
            <SecurityForm action={addVendorAction} submit="Add a provider" secondary>
              <Field label="Name" name="name" />
              <Field label="What they do" name="whatTheyDo" />
              <Field label="What information they hold" name="dataTheyHold" />
            </SecurityForm>
          ) : null}
        </div>
      </Card>

      <Card title="Accessibility complaints">
        <div id="accessibility" className="space-y-4">
          <p className="text-sm text-ink-soft">If someone tells you the website or app is hard to use, record it. Colorado lets a small business that fixes the problem within {overview.fixDays} days (starting value, not confirmed) owe a reduced amount, so the fix date goes on your To do list.</p>
          <ul className="space-y-3">
            {overview.complaints.map((c) => (
              <li key={c.id} className="space-y-2 border-b border-line pb-3 last:border-0">
                <p className="text-sm font-medium">{c.resolvedAt ? "Fixed" : `Fix by ${dateText(c.fixBy)}`} — {c.description}</p>
                {!c.resolvedAt ? (
                  <SecurityForm action={complaintResolvedAction.bind(null, c.id)} submit="Mark fixed" secondary>
                    <Field label="What was fixed" name="note" />
                  </SecurityForm>
                ) : <p className="text-xs text-ink-soft">{c.resolvedNote}</p>}
              </li>
            ))}
          </ul>
          <SecurityForm action={complaintAction} submit="Record a complaint">
            <Field label="Date received" name="receivedOn" type="date" defaultValue={today} />
            <Field label="Who told you (optional)" name="fromWho" required={false} max={200} />
            <TextArea label="What could they not use or read?" name="description" />
          </SecurityForm>
        </div>
      </Card>

      {isOwner ? (
        <Card title="Legal holds">
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">A legal hold on a customer stops every automatic clean-up and blocks their privacy deletion until you lift it. Use it when there is a dispute or a lawyer asks you to keep everything.</p>
            <ul className="space-y-3">
              {overview.holds.map((h) => (
                <li key={h.id} className="space-y-2">
                  <p className="text-sm">{h.user.name ?? h.user.email} — since {dateText(h.legalHoldAt)}: {h.legalHoldReason}</p>
                  <SecurityForm action={legalHoldAction.bind(null, false)} submit="Lift the hold" secondary>
                    <input type="hidden" name="customerId" value={h.id} />
                    <input type="hidden" name="reason" value="lifted" />
                  </SecurityForm>
                </li>
              ))}
            </ul>
            <SecurityForm action={legalHoldAction.bind(null, true)} submit="Put a customer on hold">
              <Field label="Customer's email address" name="email" type="email" />
              <Field label="Why" name="reason" max={500} />
            </SecurityForm>
          </div>
        </Card>
      ) : null}

      {isOwner ? (
        <Card title="Keeping and removing information">
          <div className="space-y-4">
            <p className="text-sm text-ink-soft">How long to keep things (starting values from the research, <strong>not confirmed</strong>: agreements and bills 7 years after the account closes, tax and mileage 7, refrigerant records 6, sales enquiries that never became customers 2, messages 3). Signed agreements, bills and payments are never removed by the app; these years only say the earliest you may remove them yourself.</p>
            <SecurityForm action={settingsAction.bind(null, false)} submit="Save">
              <Field label="Agreements and bills: years after the account closes" name="retentionAgreementYears" type="number" min={1} max={30} defaultValue={s.retentionAgreementYears} />
              <Field label="Tax and mileage records: years" name="retentionTaxYears" type="number" min={1} max={30} defaultValue={s.retentionTaxYears} />
              <Field label="Refrigerant records: years" name="retentionRefrigerantYears" type="number" min={1} max={30} defaultValue={s.retentionRefrigerantYears} />
              <Field label="Sales enquiries that never became customers: years" name="retentionLeadYears" type="number" min={1} max={30} defaultValue={s.retentionLeadYears} />
              <Field label="Messages: years" name="retentionMessageYears" type="number" min={1} max={30} defaultValue={s.retentionMessageYears} />
              <Check label="Remove old sales enquiries automatically each night" name="retentionPurgeEnabled" defaultChecked={s.retentionPurgeEnabled} hint="Starts off. When on, enquiries older than the setting above that never became customers are removed, at most 200 a night, never for a customer on legal hold. Every run is logged." />
              <Check label="Use face-match ID checks" name="faceMatchIdEnabled" defaultChecked={s.faceMatchIdEnabled} hint={FACE_MATCH_POLICY_NOTE} />
              <Field label={`Marketing texts start (hour, 24-hour clock; now ${hourLabel(s.marketingTextStartHour)})`} name="marketingTextStartHour" type="number" min={0} max={23} defaultValue={s.marketingTextStartHour} hint="Marketing texts are held outside these hours, Denver time. Starting value 8 am to 9 pm." />
              <Field label={`Marketing texts end (hour, 24-hour clock; now ${hourLabel(s.marketingTextEndHour)})`} name="marketingTextEndHour" type="number" min={0} max={23} defaultValue={s.marketingTextEndHour} />
              <Field label="Months between service-provider security checks" name="vendorReviewMonths" type="number" min={1} max={36} defaultValue={s.vendorReviewMonths} />
            </SecurityForm>
            <SecurityForm action={settingsAction.bind(null, true)} submit="Restore recommended values" secondary />
          </div>
        </Card>
      ) : null}
    </div>
  );
}
