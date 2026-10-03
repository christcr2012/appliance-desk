"use client";

import type { EditableSettingsSection } from "@/domains/settings/section-config";

import { forwardRef, useState } from "react";
import { useForm } from "react-hook-form";
import { updateSettingsAction, updateSettingsSectionAction } from "./actions";

// Money inputs are owner-facing dollars. Tax is owner-facing percent (for
// example 7.375), while the server converts it to exact integer
// thousandths-of-one-percent storage.
type FormValues = {
  publicBusinessName: string;
  publicPhone: string;
  publicEmail: string;
  publicAddress: string;
  serviceAreaCities: string;
  serviceAreaZips: string;
  deliveryFeeDollars: number;
  installationFeeDollars: number;
  removalFeeDollars: number;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
  lateFeeGraceDays: number;
  lateFeeFlatDollars: number;
  lateFeePercent: number;
  taxRatePercent: number;
  taxRateConfirmed: boolean;
  sixMonthPrepaySetDollars: number;
  sixMonthPrepaySingleDollars: number;
  twelveMonthPrepaySetDollars: number;
  twelveMonthPrepaySingleDollars: number;
  twelveMonthPrepayFreeMonthEnabled: boolean;
  referralRewardDollars: number;
  draftReservationHoldDays: number;
};

export function SettingsForm({
  defaultValues,
  section,
}: {
  defaultValues: FormValues;
  section?: EditableSettingsSection;
}) {
  const [message, setMessage] = useState<{
    kind: "success" | "error";
    text: string;
  } | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({ defaultValues });

  async function onSubmit(values: FormValues) {
    setMessage(null);
    let result;
    try {
      result = section
        ? await updateSettingsSectionAction(section, values)
        : await updateSettingsAction(values);
    } catch {
      setMessage({
        kind: "error",
        text: "Settings could not be saved. Your changes are still in the form; please try again.",
      });
      return;
    }
    if (result.status === "success") {
      setMessage({ kind: "success", text: "Settings saved." });
    } else if (result.status === "error") {
      setMessage({ kind: "error", text: result.message });
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 max-w-2xl">
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}

      {(!section || section === "profile") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Public business info
          </legend>
          <LabeledInput
            label="Business name"
            {...register("publicBusinessName")}
          />
          <LabeledInput label="Phone" {...register("publicPhone")} />
          <LabeledInput
            label="Email"
            type="email"
            {...register("publicEmail")}
          />
          <LabeledInput label="Address" {...register("publicAddress")} />
        </fieldset>
      )}

      {(!section || section === "service-area") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Service area
          </legend>
          <LabeledInput
            label="Cities (comma-separated)"
            {...register("serviceAreaCities")}
          />
          <LabeledInput
            label="ZIP codes (comma-separated)"
            {...register("serviceAreaZips")}
          />
        </fieldset>
      )}

      {(!section || section === "policies") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Fees
          </legend>
          <p className="text-sm text-gray-600">
            Delivery and installation are separate, optional one-time fees —
            each shows as its own line on the public pricing page. Leave either
            at $0.00 to not charge for it.
          </p>
          <DollarInput
            label="Delivery fee"
            {...register("deliveryFeeDollars", { valueAsNumber: true })}
          />
          <DollarInput
            label="Installation fee"
            {...register("installationFeeDollars", { valueAsNumber: true })}
          />
          <DollarInput
            label="Pickup/removal fee"
            {...register("removalFeeDollars", { valueAsNumber: true })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              {...register("depositEnabled")}
              className="h-4 w-4"
            />
            Require a refundable security deposit
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              {...register("damageWaiverEnabled")}
              className="h-4 w-4"
            />
            Offer an optional damage waiver
          </label>
          <LabeledInput
            label="Late fee grace period (days)"
            type="number"
            min={0}
            {...register("lateFeeGraceDays")}
          />
          <DollarInput
            label="Late fee — flat amount"
            {...register("lateFeeFlatDollars", { valueAsNumber: true })}
          />
          <LabeledInput
            label="Late fee — percent"
            type="number"
            min={0}
            max={100}
            {...register("lateFeePercent")}
          />
        </fieldset>
      )}

      {(!section || section === "policies") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Prepaid-term discounts
          </legend>
          <p className="text-sm text-gray-600">
            A customer who signs up for a 6- or 12-month term automatically gets
            a lower monthly rate — a &quot;set&quot; means 2 or more appliances
            on the same line (like a washer + dryer), a single appliance gets
            its own, separate rate. You can change any of these four amounts any
            time; existing signed agreements keep whatever rate they already
            locked in.
          </p>
          <DollarInput
            label="6-month prepay discount — per month, for a set"
            {...register("sixMonthPrepaySetDollars", { valueAsNumber: true })}
          />
          <DollarInput
            label="6-month prepay discount — per month, for a single appliance"
            {...register("sixMonthPrepaySingleDollars", {
              valueAsNumber: true,
            })}
          />
          <DollarInput
            label="12-month prepay discount — per month, for a set"
            {...register("twelveMonthPrepaySetDollars", {
              valueAsNumber: true,
            })}
          />
          <DollarInput
            label="12-month prepay discount — per month, for a single appliance"
            {...register("twelveMonthPrepaySingleDollars", {
              valueAsNumber: true,
            })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              {...register("twelveMonthPrepayFreeMonthEnabled")}
              className="h-4 w-4"
            />
            Also give a free month when a customer pays the full 12-month term
            in one lump sum up front (you mark this yourself when creating that
            agreement)
          </label>
        </fieldset>
      )}

      {(!section || section === "policies") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Referral program
          </legend>
          <p className="text-sm text-gray-600">
            Every customer gets their own referral code automatically (shown on
            their customer page). When someone they refer signs up using it and
            actually starts paying, you both get the same credit — a &quot;give
            one, get one.&quot; The credit is applied automatically to reduce
            that customer&apos;s next payment.
          </p>
          <DollarInput
            label="Referral reward — same amount for both people"
            {...register("referralRewardDollars", { valueAsNumber: true })}
          />
        </fieldset>
      )}

      {(!section || section === "policies") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Reserved-appliance holds
          </legend>
          <p className="text-sm text-gray-600">
            When you assign a physical appliance to a draft agreement, it&apos;s
            held for that customer and can&apos;t be rented to anyone else. If
            an agreement sits as a draft or awaiting signature for too long
            without getting signed, the desk flags it so you can free that
            appliance back up — or extend the hold if it&apos;s just a
            slow-moving deal.
          </p>
          <LabeledInput
            label="Days to hold before flagging as stale"
            type="number"
            min={1}
            max={90}
            {...register("draftReservationHoldDays", { valueAsNumber: true })}
          />
        </fieldset>
      )}

      {(!section || section === "policies") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-gray-900">
            Sales tax
          </legend>
          <p className="text-sm text-gray-600">
            Enter the ordinary percentage, up to three decimal places (for
            example 7.375). Defaults to 0% until confirmed — never guess a tax
            rate.
          </p>
          <LabeledInput
            label="Tax rate (%)"
            type="number"
            min={0}
            max={100}
            step="0.001"
            {...register("taxRatePercent", { valueAsNumber: true })}
          />
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              {...register("taxRateConfirmed")}
              className="h-4 w-4"
            />
            A CPA has confirmed this rate is correct
          </label>
        </fieldset>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isSubmitting
          ? "Saving…"
          : section
            ? "Save this section"
            : "Save settings"}
      </button>
    </form>
  );
}

const DollarInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }
>(function DollarInput({ label, ...props }, ref) {
  const id = `settings-${props.name}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-gray-900"
      >
        {label}
      </label>
      <div className="flex max-w-sm items-center gap-2">
        <span aria-hidden="true" className="text-gray-500">
          $
        </span>
        <input
          id={id}
          ref={ref}
          type="number"
          min={0}
          step="0.01"
          {...props}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
    </div>
  );
});

function LabeledInput({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = `settings-${props.name}`;
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-sm font-medium text-gray-900"
      >
        {label}
      </label>
      <input
        id={id}
        {...props}
        className="w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm"
      />
    </div>
  );
}
