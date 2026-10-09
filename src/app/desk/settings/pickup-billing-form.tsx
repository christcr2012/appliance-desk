"use client";

import { useState } from "react";
import { Button, Checkbox, Field } from "@/components/ui";
import { updatePickupBillingAction } from "./actions";
import {
  RECOMMENDED_PICKUP_BILLING_FORM,
  type PickupBillingFormValues,
} from "@/domains/settings/pickup-billing";

/**
 * "Pickups and deliveries" billing settings. Every choice is explained on the
 * screen itself: what it does, what it means for a customer, the recommended
 * starting value and why, and a button to put the recommended values back.
 */
export function PickupBillingForm({ defaultValues }: { defaultValues: PickupBillingFormValues }) {
  const [values, setValues] = useState<PickupBillingFormValues>(defaultValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updatePickupBillingAction(values);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Settings saved. They apply to every pickup and delivery recorded from now on." }
          : result.status === "error"
            ? { kind: "error", text: result.message }
            : null,
      );
    } catch {
      setMessage({
        kind: "error",
        text: "Settings could not be saved. Your changes are still in the form; please try again.",
      });
    } finally {
      setSaving(false);
    }
  }

  const radioClass = "mt-1 h-4 w-4";

  return (
    <form onSubmit={onSubmit} className="max-w-2xl space-y-8">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${
            message.kind === "success" ? "text-success" : "text-danger"
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="rounded-card border border-line bg-subtle px-4 py-3 text-sm text-ink">
        These three rules decide what a customer is charged when an appliance comes back late, credited
        when an appliance is delivered late, and whether the pickup day itself counts. Each one is a
        setting you can change at any time; the change applies to pickups and deliveries recorded after
        you save. Owners and admins can edit this section. Every charge or credit shows on the
        customer&rsquo;s bill as its own clearly labeled line, so they can see exactly what it is for.
      </p>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">1. Late return — kept past the end date</legend>
        <p className="text-sm text-ink-soft">
          When a customer keeps an appliance past the end date of their agreement, each extra day is
          charged at a daily rate, for each appliance. The charge appears on their next bill as
          &ldquo;Late return – [appliance] – [number] days&rdquo;. Choose how the daily rate is worked out:
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="radio"
              name="lateReturnRateMode"
              className={radioClass}
              checked={values.lateReturnRateMode === "MONTHLY_DIV_30"}
              onChange={() => setValues((c) => ({ ...c, lateReturnRateMode: "MONTHLY_DIV_30" }))}
            />
            <span>
              <strong>The appliance&rsquo;s monthly price ÷ 30 (recommended)</strong>
              <br />
              <span className="text-ink-soft">
                A $45-a-month appliance costs $1.50 for each late day. This is the fairest default: the
                customer pays the same daily rate they already pay, no more and no less, and you never
                have to update a separate number when prices change.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="radio"
              name="lateReturnRateMode"
              className={radioClass}
              checked={values.lateReturnRateMode === "FIXED"}
              onChange={() => setValues((c) => ({ ...c, lateReturnRateMode: "FIXED" }))}
            />
            <span>
              <strong>A fixed dollar amount per day, per appliance</strong>
              <br />
              <span className="text-ink-soft">
                Every late day costs the same amount whatever the appliance&rsquo;s price. Use this if
                you want late returns to cost noticeably more than ordinary rent, as an incentive to
                return on time. Enter the amount below.
              </span>
            </span>
          </label>
        </div>
        <div className="max-w-sm">
          <Field
            id="pickup-fixedDaily"
            label="Fixed amount per day (only used with the second choice)"
            help="Per day, per appliance. Ignored while “monthly price ÷ 30” is selected."
            inputMode="decimal"
            value={values.lateReturnFixedDailyDollars}
            onChange={(event) =>
              setValues((current) => ({
                ...current,
                lateReturnFixedDailyDollars: event.target.value,
              }))
            }
            disabled={values.lateReturnRateMode !== "FIXED"}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">
          2. Late delivery — an item that was not on the first delivery
        </legend>
        <p className="text-sm text-ink-soft">
          When one or more appliances on an agreement are not delivered on the visit that starts billing
          (for example the dryer was back-ordered), the <strong>whole agreement</strong> is billed as normal
          from that first delivery date. When the missing appliance is delivered later, the customer gets a
          credit on their <strong>next</strong> bill for each day it was missing — from the original
          delivery date through the day before it arrived — shown as &ldquo;Credit – [appliance] delivered
          late – [number] days&rdquo;. If it never arrives and you take it off the agreement, everything
          billed for it is credited. The credit is never more than what was billed for that appliance.
          Choose how the per-day credit is worked out:
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="radio"
              name="lateDeliveryProrationBasis"
              className={radioClass}
              checked={values.lateDeliveryProrationBasis === "MONTHLY_DIV_30"}
              onChange={() => setValues((c) => ({ ...c, lateDeliveryProrationBasis: "MONTHLY_DIV_30" }))}
            />
            <span>
              <strong>The appliance&rsquo;s monthly price ÷ 30 (recommended)</strong>
              <br />
              <span className="text-ink-soft">
                The same simple daily rate every month, and the same rate late returns use, so a customer
                is never charged at one rate and credited at another. A $45-a-month appliance earns $1.50
                back for each day it was missing.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-ink">
            <input
              type="radio"
              name="lateDeliveryProrationBasis"
              className={radioClass}
              checked={values.lateDeliveryProrationBasis === "ACTUAL_DAYS_IN_MONTH"}
              onChange={() =>
                setValues((c) => ({ ...c, lateDeliveryProrationBasis: "ACTUAL_DAYS_IN_MONTH" }))
              }
            />
            <span>
              <strong>The appliance&rsquo;s monthly price ÷ the real number of days in that billing month</strong>
              <br />
              <span className="text-ink-soft">
                Exact to the calendar: a 31-day month credits a little less per day and a 28-day month a
                little more, so a whole month of missing days always adds up to exactly one month&rsquo;s
                price. Slightly harder for a customer to check by hand.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">3. The pickup day itself</legend>
        <Checkbox
          id="pickup-day-not-billed"
          label="Don’t charge for the day an appliance is picked up or returned (recommended)"
          help="With this on, the pickup day is not counted as a late day: the last late day a customer pays for is the day before the pickup or return. Today this applies to late-return charges only; ending the monthly Stripe charge on the pickup date remains separate work."
          checked={values.pickupDayNotBilled}
          onChange={(event) =>
            setValues((current) => ({
              ...current,
              pickupDayNotBilled: event.target.checked,
            }))
          }
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">4. A machine taken for repair with no replacement</legend>
        <p className="text-sm text-ink-soft">
          When a visit takes a machine away and nothing replaces it, the customer keeps paying the normal price and gets a
          credit on the next bill for each day without it (worked out like a late delivery, above). To do shows “Return or
          replace” until a machine is back.
        </p>
        <div className="max-w-xs">
          <Field
            id="out-of-service-escalation-days"
            label="Days before “Return or replace” becomes urgent"
            type="number"
            min={1}
            max={60}
            step={1}
            value={values.outOfServiceEscalationDays}
            help="Recommended: 3 days. Owners and admins can change it. The credit grows each day, so a short wait keeps it small."
            onChange={(event) =>
              setValues((current) => ({ ...current, outOfServiceEscalationDays: event.target.value }))
            }
          />
        </div>
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
            setValues(RECOMMENDED_PICKUP_BILLING_FORM);
            setMessage({
              kind: "success",
              text: "The recommended values are filled in below. Nothing is saved until you press “Save this section”.",
            });
          }}
        >
          Restore recommended values
        </Button>
      </div>
    </form>
  );
}
