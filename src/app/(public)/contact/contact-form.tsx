"use client";

import { cloneElement, isValidElement, useId, useState } from "react";
import type { ReactElement } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { leadFormSchema, type LeadFormInput } from "@/domains/leads/schema";
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
    watch,
    formState: { errors, isSubmitting },
  } = useForm<LeadFormInput>({
    resolver: zodResolver(leadFormSchema),
    defaultValues: {
      accountType: "individual",
      isPropertyManager: false,
      quantity: 1,
      desiredTerm: "month-to-month",
      applianceTypeIds: [],
      consent: false,
    },
  });

  const accountType = watch("accountType");

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
      <div
        role="status"
        className="rounded-2xl bg-accent-soft p-8 text-center ring-1 ring-accent/30"
      >
        <h2 className="font-display text-2xl font-semibold text-accent-dark">
          Thanks — we&apos;ve got your request.
        </h2>
        <p className="mt-3 text-ink-soft">
          We&apos;ll follow up soon, usually the same day, to confirm details
          and get you a firm quote.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-10">
      {/* Honeypot (Phase 6A item 7 — spam protection): invisible to a
          real visitor and never announced to assistive tech, but a
          simple bot that fills in every field will fill this one too —
          see leadFormSchema's "website" field and submitLead's check.
          Not `display: none`, which some bots skip, but positioned
          off-screen so it's genuinely never seen or focused. */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          left: "-9999px",
          width: 1,
          height: 1,
          overflow: "hidden",
        }}
      >
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
          className="rounded-xl bg-danger/10 px-4 py-3 text-sm font-medium text-danger"
        >
          {serverMessage}
        </p>
      )}

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          About you
        </legend>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">
            Are you renting for yourself or a business/property?
          </span>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="radio"
                value="individual"
                {...register("accountType")}
                className="h-4 w-4"
              />
              Myself
            </label>
            <label className="flex items-center gap-2 text-sm text-ink-soft">
              <input
                type="radio"
                value="business"
                {...register("accountType")}
                className="h-4 w-4"
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
          >
            <input
              id={`${formId}-companyName`}
              type="text"
              {...register("companyName")}
              className={inputClass}
            />
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            {...register("isPropertyManager")}
            className="h-4 w-4"
          />
          I&apos;m a landlord, property manager, or apartment operator
        </label>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={`${formId}-contactName`}
            label="Your name"
            error={errors.contactName?.message}
            required
          >
            <input
              id={`${formId}-contactName`}
              type="text"
              autoComplete="name"
              {...register("contactName")}
              className={inputClass}
            />
          </Field>

          <Field
            id={`${formId}-phone`}
            label="Phone number"
            error={errors.phone?.message}
            required
          >
            <input
              id={`${formId}-phone`}
              type="tel"
              autoComplete="tel"
              {...register("phone")}
              className={inputClass}
            />
          </Field>

          <Field
            id={`${formId}-email`}
            label="Email"
            hint="Optional, but recommended"
            error={errors.email?.message}
          >
            <input
              id={`${formId}-email`}
              type="email"
              autoComplete="email"
              {...register("email")}
              className={inputClass}
            />
          </Field>

          <Field
            id={`${formId}-bestTimeToContact`}
            label="Best time to reach you"
            error={errors.bestTimeToContact?.message}
          >
            <input
              id={`${formId}-bestTimeToContact`}
              type="text"
              placeholder="e.g. weekday afternoons"
              {...register("bestTimeToContact")}
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          What you need
        </legend>

        <div>
          <span className="mb-2 block text-sm font-medium text-ink">
            Appliances you&apos;re interested in
          </span>
          <div className="grid gap-2 sm:grid-cols-2">
            {applianceTypes.map((type) => (
              <label
                key={type.id}
                className="flex items-center gap-2 rounded-lg border border-line px-4 py-3 text-sm text-ink-soft"
              >
                <input
                  type="checkbox"
                  value={type.id}
                  {...register("applianceTypeIds")}
                  className="h-4 w-4"
                />
                {type.name}
              </label>
            ))}
          </div>
          {errors.applianceTypeIds && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {errors.applianceTypeIds.message}
            </p>
          )}
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Field
            id={`${formId}-quantity`}
            label="Quantity"
            error={errors.quantity?.message}
          >
            <input
              id={`${formId}-quantity`}
              type="number"
              min={1}
              max={50}
              {...register("quantity", { valueAsNumber: true })}
              className={inputClass}
            />
          </Field>

          <div>
            <label
              htmlFor={`${formId}-desiredTerm`}
              className="mb-1 block text-sm font-medium text-ink"
            >
              Desired term
            </label>
            <select
              id={`${formId}-desiredTerm`}
              {...register("desiredTerm")}
              className={inputClass}
            >
              {TERM_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <Field
            id={`${formId}-desiredStartDate`}
            label="Desired start date"
            error={errors.desiredStartDate?.message}
          >
            <input
              id={`${formId}-desiredStartDate`}
              type="date"
              {...register("desiredStartDate")}
              className={inputClass}
            />
          </Field>
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
              error={errors.addressLine1?.message}
            >
              <input
                id={`${formId}-addressLine1`}
                type="text"
                autoComplete="address-line1"
                {...register("addressLine1")}
                className={inputClass}
              />
            </Field>
          </div>
          <Field
            id={`${formId}-city`}
            label="City"
            error={errors.city?.message}
          >
            <input
              id={`${formId}-city`}
              type="text"
              autoComplete="address-level2"
              {...register("city")}
              className={inputClass}
            />
          </Field>
          <Field id={`${formId}-zip`} label="ZIP code" error={errors.zip?.message}>
            <input
              id={`${formId}-zip`}
              type="text"
              inputMode="numeric"
              autoComplete="postal-code"
              {...register("zip")}
              className={inputClass}
            />
          </Field>
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
        >
          <input
            id={`${formId}-howHeard`}
            type="text"
            {...register("howHeard")}
            className={inputClass}
          />
        </Field>
        <Field id={`${formId}-notes`} label="Notes" error={errors.notes?.message}>
          <textarea
            id={`${formId}-notes`}
            rows={4}
            {...register("notes")}
            className={inputClass}
          />
        </Field>
        <Field
          id={`${formId}-referralCode`}
          label="Referral code (optional)"
          error={errors.referralCode?.message}
        >
          <input
            id={`${formId}-referralCode`}
            type="text"
            placeholder="Got a code from a friend? Enter it here"
            {...register("referralCode")}
            className={inputClass}
          />
        </Field>
      </fieldset>

      <div>
        <label className="flex items-start gap-3 text-sm text-ink-soft">
          <input
            type="checkbox"
            {...register("consent")}
            aria-describedby={
              errors.consent ? `${formId}-consent-error` : undefined
            }
            aria-invalid={errors.consent ? true : undefined}
            className="mt-0.5 h-4 w-4"
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
            className="mt-2 text-sm text-danger"
          >
            {errors.consent.message}
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={isSubmitting}
        className="inline-flex items-center justify-center rounded-full bg-primary px-8 py-3.5 text-base font-semibold text-on-primary shadow-sm transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Sending…" : "Request a quote"}
      </button>
    </form>
  );
}

const inputClass =
  "w-full rounded-lg border border-line-strong bg-surface px-3.5 py-2.5 text-ink placeholder:text-ink-faint focus-visible:border-primary";

function Field({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: ReactElement<{
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }>;
}) {
  const errorId = `${id}-error`;
  const field = isValidElement(children)
    ? cloneElement(children, {
        "aria-invalid": error ? true : undefined,
        "aria-describedby": error ? errorId : undefined,
      })
    : children;

  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {hint && <p className="mb-1 text-xs text-ink-faint">{hint}</p>}
      {field}
      {error && (
        <p id={errorId} role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
