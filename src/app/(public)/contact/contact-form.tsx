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
import { RichText } from "@/components/site/rich-text";
import { submitLead } from "./actions";

type ApplianceTypeOption = {
  id: string;
  name: string;
};

const TERM_OPTIONS = [
  { value: "month-to-month", label: "Month-to-month" },
  { value: "6-month", label: "6 months" },
  { value: "12-month", label: "12 months" },
] as const;

type PackageOption = ApplianceTypeOption & { contents: string };

export function ContactForm({
  applianceTypes,
  packages = [],
  copy,
}: {
  /** The words on the form, from the website content (V-C3). */
  copy: Record<string, string>;
  applianceTypes: ApplianceTypeOption[];
  packages?: PackageOption[];
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
    resolver: zodResolver(leadFormSchemaForCatalog(applianceTypes.length + packages.length > 0)),
    defaultValues: {
      accountType: "individual",
      isPropertyManager: false,
      quantity: 1,
      desiredTerm: "month-to-month",
      applianceTypeIds: [],
      packageIds: [],
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
          title={copy["contact.thanks.title"]}
          className="text-center"
        >
          <p className="text-ink-soft">
            {copy["contact.thanks.body"]}
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
          {copy["contact.form.about"]}
        </legend>

        <div>
          <span
            id={`${formId}-account-type-label`}
            className="mb-2 block text-sm font-semibold text-ink"
          >
            {copy["contact.form.accountType"]}
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
              {copy["contact.form.individual"]}
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="radio"
                value="business"
                {...register("accountType")}
                className="h-5 w-5"
              />
              {copy["contact.form.business"]}
            </label>
          </div>
        </div>

        {accountType === "business" && (
          <Field
            id={`${formId}-companyName`}
            label={copy["contact.form.companyName"]}
            error={errors.companyName?.message}
            {...register("companyName")}
          />
        )}

        <Checkbox
          label={copy["contact.form.propertyManager"]}
          {...register("isPropertyManager")}
        />

        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            id={`${formId}-contactName`}
            label={copy["contact.form.contactName"]}
            autoComplete="name"
            required
            error={errors.contactName?.message}
            {...register("contactName")}
          />
          <Field
            id={`${formId}-phone`}
            label={copy["contact.form.phone"]}
            type="tel"
            autoComplete="tel"
            required
            error={errors.phone?.message}
            {...register("phone")}
          />
          <Field
            id={`${formId}-email`}
            label={copy["contact.form.email"]}
            type="email"
            autoComplete="email"
            help={copy["contact.form.emailHelp"]}
            error={errors.email?.message}
            {...register("email")}
          />
          <Field
            id={`${formId}-bestTimeToContact`}
            label={copy["contact.form.bestTime"]}
            placeholder={copy["contact.form.bestTimeExample"]}
            error={errors.bestTimeToContact?.message}
            {...register("bestTimeToContact")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          {copy["contact.form.need"]}
        </legend>

        <div>
          <span className="mb-2 block text-sm font-semibold text-ink">
            {copy["contact.form.appliances"]}
          </span>
          {applianceTypes.length + packages.length === 0 && (
            <p className="text-sm text-ink-soft">
              {copy["contact.form.noAppliances"]}
            </p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {packages.map((set) => (
              <div
                key={set.id}
                className="rounded-control border border-line bg-surface px-3"
              >
                <Checkbox
                  label={`${set.name} (${set.contents})`}
                  value={set.id}
                  {...register("packageIds")}
                />
              </div>
            ))}
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
            label={copy["contact.form.quantity"]}
            type="number"
            min={1}
            max={50}
            error={errors.quantity?.message}
            {...register("quantity", { valueAsNumber: true })}
          />
          <Select
            id={`${formId}-desiredTerm`}
            label={copy["contact.form.term"]}
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
            label={copy["contact.form.startDate"]}
            type="date"
            error={errors.desiredStartDate?.message}
            {...register("desiredStartDate")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          {copy["contact.form.where"]}
        </legend>
        <div className="grid gap-5 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <Field
              id={`${formId}-addressLine1`}
              label={copy["contact.form.address"]}
              autoComplete="address-line1"
              error={errors.addressLine1?.message}
              {...register("addressLine1")}
            />
          </div>
          <Field
            id={`${formId}-city`}
            label={copy["contact.form.city"]}
            autoComplete="address-level2"
            error={errors.city?.message}
            {...register("city")}
          />
          <Field
            id={`${formId}-zip`}
            label={copy["contact.form.zip"]}
            inputMode="numeric"
            autoComplete="postal-code"
            error={errors.zip?.message}
            {...register("zip")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="font-display text-xl font-semibold text-ink">
          {copy["contact.form.more"]}
        </legend>
        <Field
          id={`${formId}-howHeard`}
          label={copy["contact.form.howHeard"]}
          error={errors.howHeard?.message}
          {...register("howHeard")}
        />
        <Textarea
          id={`${formId}-notes`}
          label={copy["contact.form.notes"]}
          rows={4}
          error={errors.notes?.message}
          {...register("notes")}
        />
        <Field
          id={`${formId}-referralCode`}
          label={copy["contact.form.referral"]}
          placeholder={copy["contact.form.referralExample"]}
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
            <RichText text={copy["contact.form.consent"] ?? ""} />
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
        {isSubmitting ? copy["contact.form.sending"] : copy["contact.form.submit"]}
      </Button>
    </form>
  );
}
