"use client";

import { useId, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Button,
  Card,
  Checkbox,
  Field,
  Select,
  Textarea,
} from "@/components/ui";
import {
  leadFormSchemaForCatalog,
  type LeadFormInput,
} from "@/domains/leads/schema";
import { submitLead } from "./actions";

type ApplianceTypeOption = {
  id: string;
  name: string;
  monthlyPriceCents: number;
};

const TERM_OPTIONS = [
  { value: "month-to-month", label: "Month-to-month" },
  { value: "6-month", label: "6 months" },
  { value: "12-month", label: "12 months" },
] as const;

export function ContactForm({
  applianceTypes,
}: {
  applianceTypes: ApplianceTypeOption[];
}) {
  const [submitState, setSubmitState] = useState<
    "idle" | "success" | "error"
  >("idle");
  const [serverMessage, setServerMessage] = useState<string | null>(null);
  const formId = useId();

  const {
    register,
    handleSubmit,
    control,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormInput>({
    resolver: zodResolver(leadFormSchemaForCatalog(applianceTypes.length > 0)),
    defaultValues: {
      accountType: "individual",
      isPropertyManager: false,
      quantity: 1,
      desiredTerm: "month-to-month",
      applianceTypeIds: [],
      consent: false,
    },
  });

  const accountType = useWatch({ control, name: "accountType" });

  async function onSubmit(values: LeadFormInput) {
    setServerMessage(null);
    const result = await submitLead(values);
    if (result.status === "success") {
      setSubmitState("success");
    } else if (result.status === "error") {
      setSubmitState("error");
      setServerMessage(result.message);
    }
  }

  if (submitState === "success") {
    return (
      <div role="status">
        <Card
          title="Thanks — we've got your request."
          className="text-center"
        >
          <p className="text-ink-soft">
            We&apos;ll follow up soon, usually the same day, to confirm details
            and get you a firm quote.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-10">
      <div aria-hidden="true" className="sr-only">
        <label htmlFor={`${formId}-website`}>Leave this field blank</label>
        <input
          id={`${formId}-website`}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          {...register("website")}
        />
      </div>

      {serverMessage && (
        <p
          role="alert"
          className="rounded-control border border-line bg-subtle px-4 py-3 text-sm font-semibold text-danger"
        >
          {serverMessage}
        </p>
      )}

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          About you
        </legend>

        <div>
          <span
            id={`${formId}-account-type-label`}
            className="mb-2 block text-sm font-semibold text-ink"
          >
            Are you renting for yourself or a business/property?
          </span>
          <div
            role="radiogroup"
            aria-labelledby={`${formId}-account-type-label`}
            className="flex flex-wrap gap-6"
          >
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                value="individual"
                {...register("accountType")}
                className="h-5 w-5"
              />
              Myself
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                value="business"
                {...register("accountType")}
                className="h-5 w-5"
              />
              Business / property
            </label>
          </div>
        </div>

        {accountType === "business" && (
          <Field
            id={`${formId}-companyName`}
            label="Company name"
            error={errors.companyName?.message}
            {...register("companyName")}
          />
        )}

        <Checkbox
          label="I'm a landlord, property manager, or apartment operator"
          {...register("isPropertyManager")}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={`${formId}-contactName`}
            label="Your name"
            autoComplete="name"
            required
            error={errors.contactName?.message}
            {...register("contactName")}
          />
          <Field
            id={`${formId}-phone`}
            label="Phone number"
            type="tel"
            autoComplete="tel"
            required
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Field
            id={`${formId}-email`}
            label="Email"
            type="email"
            autoComplete="email"
            help="Optional, but recommended"
            error={errors.email?.message}
            {...register("email")}
          />
          <Field
            id={`${formId}-bestTimeToContact`}
            label="Best time to reach you"
            placeholder="e.g. weekday afternoons"
            error={errors.bestTimeToContact?.message}
            {...register("bestTimeToContact")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          What you need
        </legend>

        <div>
          <span className="mb-2 block text-sm font-semibold text-ink">
            Appliances you&apos;re interested in
          </span>
          {applianceTypes.length === 0 && (
            <p className="text-sm text-ink-soft">
              No appliance options are listed yet. Tell us what you need in the
              notes below.
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {applianceTypes.map((type) => (
              <div
                key={type.id}
                className="rounded-control border border-line bg-surface px-3"
              >
                <Checkbox
                  label={type.name}
                  value={type.id}
                  {...register("applianceTypeIds")}
                />
              </div>
            ))}
          </div>
          {errors.applianceTypeIds && (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">
              {errors.applianceTypeIds.message}
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            id={`${formId}-quantity`}
            label="Quantity"
            type="number"
            min={1}
            max={50}
            error={errors.quantity?.message}
            {...register("quantity", { valueAsNumber: true })}
          />
          <Select
            id={`${formId}-desiredTerm`}
            label="Desired term"
            error={errors.desiredTerm?.message}
            {...register("desiredTerm")}
          >
            {TERM_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Field
            id={`${formId}-desiredStartDate`}
            label="Desired start date"
            type="date"
            error={errors.desiredStartDate?.message}
            {...register("desiredStartDate")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          Where
        </legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Field
              id={`${formId}-addressLine1`}
              label="Service address"
              autoComplete="address-line1"
              error={errors.addressLine1?.message}
              {...register("addressLine1")}
            />
          </div>
          <Field
            id={`${formId}-city`}
            label="City"
            autoComplete="address-level2"
            error={errors.city?.message}
            {...register("city")}
          />
          <Field
            id={`${formId}-zip`}
            label="ZIP code"
            inputMode="numeric"
            autoComplete="postal-code"
            error={errors.zip?.message}
            {...register("zip")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          Anything else
        </legend>
        <Field
          id={`${formId}-howHeard`}
          label="How did you hear about us?"
          error={errors.howHeard?.message}
          {...register("howHeard")}
        />
        <Textarea
          id={`${formId}-notes`}
          label="Notes"
          rows={4}
          error={errors.notes?.message}
          {...register("notes")}
        />
        <Field
          id={`${formId}-referralCode`}
          label="Referral code (optional)"
          placeholder="Got a code from a friend? Enter it here"
          error={errors.referralCode?.message}
          {...register("referralCode")}
        />
      </fieldset>

      <div>
        <label className="flex min-h-11 items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            {...register("consent")}
            aria-describedby={
              errors.consent ? `${formId}-consent-error` : undefined
            }
            aria-invalid={errors.consent ? true : undefined}
            className="mt-1 h-5 w-5 rounded-control border border-control bg-surface"
          />
          <span>
            I agree to the{" "}
            <a href="/privacy" className="underline hover:text-primary">
              privacy policy
            </a>{" "}
            and{" "}
            <a href="/terms" className="underline hover:text-primary">
              terms
            </a>
            .
          </span>
        </label>
        {errors.consent && (
          <p
            id={`${formId}-consent-error`}
            role="alert"
            className="mt-1 text-sm font-semibold text-danger"
          >
            {errors.consent.message}
          </p>
        )}
      </div>

      <Button type="submit" size="lg" disabled={isSubmitting}>
        {isSubmitting ? "Sending…" : "Request a quote"}
      </Button>
    </form>
  );
}
