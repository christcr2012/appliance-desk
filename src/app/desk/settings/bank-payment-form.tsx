"use client";
import { useActionState } from "react";
import { InfoTip } from "@/components/ui/info-tip";
import { saveBankPaymentSettingsAction } from "./bank-payment-actions";
import { BANK_PAYMENT_SLOW_DAYS_DEFAULT, BANK_PAYMENT_SLOW_DAYS_MAX, BANK_PAYMENT_SLOW_DAYS_MIN } from "@/domains/billing/in-flight";

export function BankPaymentForm({ days, editable }: { days: number; editable: boolean }) {
  const [state, action, pending] = useActionState(saveBankPaymentSettingsAction, { error: "", success: "" });
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-soft">
        Starting value: {BANK_PAYMENT_SLOW_DAYS_DEFAULT} banking days — not confirmed. Banks usually take up to 4.
      </p>
      <form action={action} className="grid min-w-0 gap-3 md:max-w-sm">
        <label className="grid min-w-0 gap-1 text-sm font-medium">
          Banking days before a bank payment goes on To do <InfoTip term="bill-processing" />
          <input
            type="number"
            name="bankPaymentSlowBusinessDays"
            min={BANK_PAYMENT_SLOW_DAYS_MIN}
            max={BANK_PAYMENT_SLOW_DAYS_MAX}
            defaultValue={days}
            required
            disabled={!editable}
            className="min-w-0 w-full max-w-full rounded-control border border-line p-2"
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button disabled={!editable || pending} type="submit" className="min-h-11 rounded-control border border-line px-4 font-medium">Save</button>
          <button disabled={!editable || pending} name="operation" value="restore" formNoValidate type="submit" className="min-h-11 rounded-control border border-line px-4 text-sm">Restore recommended</button>
        </div>
      </form>
      {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
      {state.success ? <p role="status" className="text-sm text-ink">{state.success}</p> : null}
      {!editable ? <p className="text-sm text-ink-soft">Only the owner can change this.</p> : null}
    </div>
  );
}
