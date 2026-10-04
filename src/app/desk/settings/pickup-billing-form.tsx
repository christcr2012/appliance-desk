"use client";

import { useState } from "react";
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
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900">
        These three rules decide what a customer is charged when an appliance comes back late, credited
        when an appliance is delivered late, and whether the pickup day itself counts. Each one is a
        setting you can change at any time; the change applies to pickups and deliveries recorded after
        you save. Owners and admins can edit this section. Every charge or credit shows on the
        customer&rsquo;s bill as its own clearly labeled line, so they can see exactly what it is for.
      </p>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">1. Late return — kept past the end date</legend>
        <p className="text-sm text-gray-600">
          When a customer keeps an appliance past the end date of their agreement, each extra day is
          charged at a daily rate, for each appliance. The charge appears on their next bill as
          &ldquo;Late return – [appliance] – [number] days&rdquo;. Choose how the daily rate is worked out:
        </p>
        <div className="space-y-3">
          <label className="flex items-start gap-3 text-sm text-gray-900">
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
              <span className="text-gray-600">
                A $45-a-month appliance costs $1.50 for each late day. This is the fairest default: the
                customer pays the same daily rate they already pay, no more and no less, and you never
                have to update a separate number when prices change.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-gray-900">
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
              <span className="text-gray-600">
                Every late day costs the same amount whatever the appliance&rsquo;s price. Use this if
                you want late returns to cost noticeably more than ordinary rent, as an incentive to
                return on time. Enter the amount below.
              </span>
            </span>
          </label>
        </div>
        <div>
          <label htmlFor="pickup-fixedDaily" className="mb-1 block text-sm font-medium text-gray-900">
            Fixed amount per day (only used with the second choice)
          </label>
          <div className="flex max-w-sm items-center gap-2">
            <span aria-hidden="true" className="text-gray-500">
              $
            </span>
            <input
              id="pickup-fixedDaily"
              inputMode="decimal"
              value={values.lateReturnFixedDailyDollars}
              onChange={(e) => setValues((c) => ({ ...c, lateReturnFixedDailyDollars: e.target.value }))}
              aria-describedby="pickup-fixedDaily-help"
              disabled={values.lateReturnRateMode !== "FIXED"}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100"
            />
          </div>
          <p id="pickup-fixedDaily-help" className="mt-1 text-xs text-gray-600">
            Per day, per appliance. Ignored while &ldquo;monthly price ÷ 30&rdquo; is selected.
          </p>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">
          2. Late delivery — an item that was not on the first delivery
        </legend>
        <p className="text-sm text-gray-600">
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
          <label className="flex items-start gap-3 text-sm text-gray-900">
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
              <span className="text-gray-600">
                The same simple daily rate every month, and the same rate late returns use, so a customer
                is never charged at one rate and credited at another. A $45-a-month appliance earns $1.50
                back for each day it was missing.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm text-gray-900">
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
              <span className="text-gray-600">
                Exact to the calendar: a 31-day month credits a little less per day and a 28-day month a
                little more, so a whole month of missing days always adds up to exactly one month&rsquo;s
                price. Slightly harder for a customer to check by hand.
              </span>
            </span>
          </label>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">3. The pickup day itself</legend>
        <label className="flex items-start gap-3 text-sm text-gray-900">
          <input
            type="checkbox"
            className={radioClass}
            checked={values.pickupDayNotBilled}
            onChange={(e) => setValues((c) => ({ ...c, pickupDayNotBilled: e.target.checked }))}
          />
          <span>
            <strong>Don&rsquo;t charge for the day an appliance is picked up or returned (recommended)</strong>
            <br />
            <span className="text-gray-600">
              With this on, the pickup day is not counted as a late day: the last late day a customer
              pays for is the day <em>before</em> the pickup or return, so an appliance picked up on the
              1st of the month is not charged for the 1st. It is on to start with because the customer
              usually cannot use the appliance on the day it is taken away. Turn it off to charge for the
              pickup day like any other day. Today this applies to late-return charges only; ending the
              monthly Stripe charge on the pickup date is a later piece of work and is not built yet.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <button
          type="submit"
          disabled={saving}
          className="rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save this section"}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            setValues(RECOMMENDED_PICKUP_BILLING_FORM);
            setMessage({
              kind: "success",
              text: "The recommended values are filled in below. Nothing is saved until you press “Save this section”.",
            });
          }}
          className="rounded-full border border-gray-400 px-5 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-60"
        >
          Restore recommended values
        </button>
      </div>
    </form>
  );
}
