"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { updateEarlyReturnAction } from "./actions";
import { RECOMMENDED_EARLY_RETURN, type EarlyReturnFormValues } from "@/domains/settings/early-return";

/**
 * "When equipment comes back early". Every choice is explained on the screen itself: what it does, what it means
 * for a customer, the recommended starting value and why, and a button to put the recommended values back.
 * These are only defaults: the early-return screen lets you change any of them for one rental.
 */
export function EarlyReturnForm({ defaultValues }: { defaultValues: EarlyReturnFormValues }) {
  const [values, setValues] = useState<EarlyReturnFormValues>(defaultValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateEarlyReturnAction(values);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Saved. These apply to every rental whose equipment comes back early from now on." }
          : result.status === "error"
            ? { kind: "error", text: result.message }
            : null,
      );
    } catch {
      setMessage({ kind: "error", text: "Settings could not be saved. Your changes are still in the form; please try again." });
    } finally {
      setSaving(false);
    }
  }

  const radio = "mt-1 h-4 w-4";
  const choice = <K extends keyof EarlyReturnFormValues>(key: K, value: EarlyReturnFormValues[K], title: string, body: string) => (
    <label className="flex items-start gap-3 text-sm text-ink">
      <input type="radio" name={key} className={radio} checked={values[key] === value} onChange={() => setValues((c) => ({ ...c, [key]: value }))} />
      <span>
        <strong>{title}</strong>
        <br />
        <span className="text-ink-soft">{body}</span>
      </span>
    </label>
  );

  return (
    <form onSubmit={onSubmit} className="mt-10 max-w-2xl space-y-8 border-t border-line pt-8" aria-labelledby="early-return-heading">
      <h3 id="early-return-heading" className="text-lg font-semibold text-ink">
        When equipment comes back early
      </h3>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${message.kind === "success" ? "text-success" : "text-danger"}`}
        >
          {message.text}
        </p>
      )}
      <p className="rounded-card border border-line bg-subtle px-4 py-3 text-sm text-ink">
        This is what happens when a customer returns <strong>all</strong> of their equipment before the rental&rsquo;s
        agreed ending (or a month-to-month customer returns everything without having asked to end). These are your
        standard choices. For any one rental you can look at the numbers and change any choice before you confirm.
        Nothing here ever charges a customer&rsquo;s card by itself: a fee always becomes an open bill. Owners and
        admins can change this section.
      </p>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">1. The monthly bill</legend>
        {choice(
          "billing",
          "KEEP_TO_AGREED_END",
          "Keep billing to the agreed ending (recommended)",
          "The customer keeps paying until the ending already agreed. If no ending was agreed yet, one is recorded using the rental's own notice rules, as if they had asked on the pickup day. This is the starting value because it follows the contract the customer signed.",
        )}
        {choice(
          "billing",
          "END_AT_PICKUP",
          "Stop billing at pickup",
          "The rental ends on the pickup day and no further monthly charge is made. Days already paid for after that are handled by choice 2.",
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">2. Days already paid for (only when billing stops at pickup)</legend>
        {choice("unusedDays", "KEEP", "Keep them (recommended)", "Nothing goes back to the customer. This is the starting value because the monthly price is paid in advance with no part-month refunds.")}
        {choice("unusedDays", "CREDIT", "Give account credit", "The unused days become a credit on the customer's account, to use against a bill or refund later.")}
        {choice("unusedDays", "REFUND", "Refund them", "Money paid by card or bank is refunded to the same card or bank. Money paid another way is listed for you to pay back by hand.")}
        <fieldset className="mt-4 space-y-3">
          <legend className="text-sm font-medium text-ink">How a day is priced when you credit or refund</legend>
          {choice("prorationBasis", "MONTHLY_DIV_30", "The monthly price ÷ 30 (recommended)", "The same simple daily rate late returns and late deliveries use.")}
          {choice("prorationBasis", "ACTUAL_DAYS_IN_MONTH", "The monthly price ÷ the real days in that billing month", "Exact to the calendar, so a whole unused month adds up to exactly one month's price.")}
        </fieldset>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">3. Early-ending fee (fixed-term rentals only)</legend>
        {choice("fee", "AGREED_TERMS_FEE", "Charge the fee in the customer's own signed terms (recommended)", "The same amount the customer would be quoted for asking to end early. It is added as an open bill, never charged automatically. Month-to-month rentals never have a fee.")}
        {choice("fee", "NO_FEE", "No fee", "Early returns never carry a fee unless you add one on the screen for that rental.")}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="text-base font-semibold text-ink">4. Who decides</legend>
        {choice("handling", "ASK_ME", "Ask me each time (recommended)", "Today shows “Returned early — choose what to do” with your standard choices already selected. Billing carries on until you confirm. A rental paid in full in advance always asks you.")}
        {choice("handling", "APPLY_DEFAULTS", "Apply my standard choices automatically", "They are applied the moment the pickup is completed. Today shows what was done, and you can still change it while no refund or credit has been given and no fee has been paid.")}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save this section"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={saving}
          onClick={() => {
            setValues({ ...RECOMMENDED_EARLY_RETURN });
            setMessage({ kind: "success", text: "The recommended values are filled in. Nothing is saved until you press “Save this section”." });
          }}
        >
          Restore recommended values
        </Button>
      </div>
    </form>
  );
}
