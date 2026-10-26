import type { LateFeeStanding } from "@/domains/billing/invoice-detail";
import { formatCents } from "@/domains/pricing";
import { formatBusinessDate } from "@/lib/business-date";
import { sendLateWarningAction, skipLateFeeAction, toldByPhoneAction, waiveLateFeeAction } from "@/app/desk/billing/late-fee-actions";
import { InfoTip } from "@/components/ui/info-tip";

// FEE-1: one calm box on the bill page that says where the late fee stands and offers only the choices that make sense.
const BUTTON = "min-h-11 rounded-control border border-line px-4 text-sm font-medium";

function ReasonForm({ action, hidden, button, label }: { action: (form: FormData) => Promise<void>; hidden: Record<string, string>; button: string; label: string }) {
  return (
    <form action={action} className="flex min-w-0 flex-wrap items-end gap-2">
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <label className="grid min-w-0 gap-1 text-sm font-medium">
        {label}
        <input name="reason" required minLength={3} maxLength={400} className="min-w-0 w-full max-w-full rounded-control border border-line p-2 sm:w-72" />
      </label>
      <button type="submit" className={BUTTON}>{button}</button>
    </form>
  );
}

export function LateFeeSection({ invoiceId, standing }: { invoiceId: string; standing: LateFeeStanding | null }) {
  if (!standing) return null;
  return (
    <section aria-labelledby="late-fee-heading" className="mt-4 rounded-xl border border-line bg-surface p-4 print:hidden">
      <h2 id="late-fee-heading" className="font-semibold text-ink">
        Late fee <InfoTip term="late-fee-next-bill" />
      </h2>
      {standing.state === "WILL_BE_ADDED" && (
        <p className="mt-1 text-sm text-ink-soft">
          Late fee will be added to the next bill on {formatBusinessDate(standing.feeDate)} · {formatCents(standing.feeCents)}, if this is still unpaid. The customer was warned.
        </p>
      )}
      {standing.state === "NOT_WARNED" && (
        <div className="mt-1 space-y-3">
          <p className="text-sm text-ink-soft">No late fee yet — the customer was not warned. A fee needs a warning first.</p>
          <div className="flex flex-wrap gap-2">
            <form action={sendLateWarningAction}>
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <button type="submit" className={`${BUTTON} bg-primary text-white`}>Send the warning</button>
            </form>
            <form action={toldByPhoneAction}>
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <button type="submit" className={BUTTON}>I told them by phone</button>
            </form>
          </div>
          <ReasonForm action={skipLateFeeAction} hidden={{ invoiceId }} button="Skip the fee" label="Why skip it?" />
        </div>
      )}
      {standing.state === "MILITARY" && (
        <div className="mt-1 space-y-3">
          <p className="text-sm text-ink-soft">No automatic late fee — this customer is marked as active military. You decide.</p>
          <ReasonForm action={skipLateFeeAction} hidden={{ invoiceId }} button="Skip the fee" label="Why skip it?" />
        </div>
      )}
      {standing.state === "RECORDED" && (
        <div className="mt-1 space-y-3">
          <p className="text-sm text-ink-soft">Late fee of {formatCents(standing.feeCents)} will be added to the customer&apos;s next bill. This bill stays as it is.</p>
          <ReasonForm action={waiveLateFeeAction} hidden={{ chargeId: standing.chargeId }} button="Waive the fee" label="Why waive it?" />
        </div>
      )}
      {standing.state === "BILLED" && (
        <div className="mt-1 space-y-3">
          <p className="text-sm text-ink-soft">
            Late fee of {formatCents(standing.feeCents)} was added{standing.onBillNumber ? ` to bill #${standing.onBillNumber}` : " to the next bill"}.
          </p>
          {standing.waivable ? <ReasonForm action={waiveLateFeeAction} hidden={{ chargeId: standing.chargeId }} button="Give it back as a credit" label="Why give it back?" /> : null}
        </div>
      )}
      {standing.state === "WAIVED" && (
        <p className="mt-1 text-sm text-ink-soft">
          Late fee waived{standing.reason ? ` — ${standing.reason}` : ""}.
        </p>
      )}
    </section>
  );
}
