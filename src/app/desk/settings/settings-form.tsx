"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { updateSettingsAction } from "./actions";

type FormValues = {
  publicBusinessName: string;
  publicPhone: string;
  publicEmail: string;
  publicAddress: string;
  serviceAreaCities: string;
  serviceAreaZips: string;
  oneTimeDeliveryFeeCents: number;
  oneTimeRemovalFeeCents: number;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
  lateFeeGraceDays: number;
  lateFeeFlatCents: number;
  lateFeePercent: number;
  taxRatePermille: number;
  taxRateConfirmed: boolean;
};

export function SettingsForm({ defaultValues }: { defaultValues: FormValues }) {
  const [message, setMessage] = useState<
    { kind: "success" | "error"; text: string } | null
  >(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<FormValues>({ defaultValues });

  async function onSubmit(values: FormValues) {
    setMessage(null);
    const result = await updateSettingsAction(values);
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
          role="status"
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "success"
              ? "bg-green-50 text-green-800"
              : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">
          Public business info
        </legend>
        <LabeledInput label="Business name" {...register("publicBusinessName")} />
        <LabeledInput label="Phone" {...register("publicPhone")} />
        <LabeledInput label="Email" type="email" {...register("publicEmail")} />
        <LabeledInput label="Address" {...register("publicAddress")} />
      </fieldset>

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

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">
          Fees
        </legend>
        <LabeledInput
          label="Delivery/installation fee (cents)"
          type="number"
          min={0}
          {...register("oneTimeDeliveryFeeCents")}
        />
        <LabeledInput
          label="Pickup/removal fee (cents)"
          type="number"
          min={0}
          {...register("oneTimeRemovalFeeCents")}
        />
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" {...register("depositEnabled")} className="h-4 w-4" />
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
        <LabeledInput
          label="Late fee — flat (cents)"
          type="number"
          min={0}
          {...register("lateFeeFlatCents")}
        />
        <LabeledInput
          label="Late fee — percent"
          type="number"
          min={0}
          max={100}
          {...register("lateFeePercent")}
        />
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">
          Sales tax
        </legend>
        <p className="text-sm text-gray-600">
          Defaults to 0% until confirmed with a CPA — never guess a tax
          rate (see docs/BUSINESS-RULES.md).
        </p>
        <LabeledInput
          label="Tax rate (permille — e.g. 29 = 2.9%)"
          type="number"
          min={0}
          max={1000}
          {...register("taxRatePermille")}
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

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isSubmitting ? "Saving…" : "Save settings"}
      </button>
    </form>
  );
}

function LabeledInput({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = `settings-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-900">
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
