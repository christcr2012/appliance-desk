"use client";

import type { EditableSettingsSection } from "@/domains/settings/section-config";

import { forwardRef, useState } from "react";
import { Button, Checkbox, Field, Select, Textarea } from "@/components/ui";
import { DAYS, SOCIAL_NETWORKS, BRAND_LOGO_FILES, MAX_CLOSURES, type ProfileExtrasForm } from "@/domains/settings/profile-extras";
import { useForm } from "react-hook-form";
import { updateSettingsAction, updateSettingsSectionAction } from "./actions";

// Every "...Dollars" field here is entered and displayed in real dollars
// and cents (e.g. 45.00), matching how Chris actually thinks about
// pricing — not the database's internal integer-cents storage. The
// server action is what converts dollars → cents before saving; see
// docs/BUSINESS-RULES.md ("money is stored as integer cents, never
// floating point") — that rule is about storage, not this form.
type FormValues = ProfileExtrasForm & {
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
  taxRatePercentText: string;
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
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${
            message.kind === "success" ? "text-success" : "text-danger"
          }`}
        >
          {message.text}
        </p>
      )}

      {(!section || section === "profile") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-ink">
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

      {(!section || section === "profile") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-ink">
            Opening hours
          </legend>
          <p className="text-sm text-ink-soft">
            Shown in the website footer and on the contact page. For each day choose <strong>Not shown</strong> (the
            day is left out), <strong>Closed</strong>, or <strong>Open</strong> and fill in the times (24-hour clock,
            Colorado time). Starting value: nothing shown, so no hours are promised until you set them.
          </p>
          <div className="space-y-3">
            {DAYS.map((day) => (
              <div
                key={day.id}
                className="grid gap-3 rounded-card border border-line bg-subtle p-3 sm:grid-cols-3"
              >
                <Select
                  id={`hours-${day.id}-mode`}
                  label={day.label}
                  {...register(`hours.${day.id}.mode`)}
                >
                  <option value="none">Not shown</option>
                  <option value="closed">Closed</option>
                  <option value="open">Open</option>
                </Select>
                <Field
                  id={`hours-${day.id}-open`}
                  label="Opens"
                  type="time"
                  {...register(`hours.${day.id}.open`)}
                />
                <Field
                  id={`hours-${day.id}-close`}
                  label="Closes"
                  type="time"
                  {...register(`hours.${day.id}.close`)}
                />
              </div>
            ))}
          </div>
          <p className="text-xs text-ink-soft">The times are used only for days set to Open.</p>
          <div className="max-w-sm">
            <Textarea
              id="settings-holidayClosuresText"
              label="Holiday closures"
              help={`One per line: the date, a space, then the name. Example: 2026-12-25 Christmas Day. Up to ${MAX_CLOSURES}. Past dates stop showing on the website by themselves.`}
              rows={4}
              {...register("holidayClosuresText")}
            />
          </div>
        </fieldset>
      )}

      {(!section || section === "profile") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-ink">
            Social links and logo
          </legend>
          <p className="text-sm text-ink-soft">
            Leave a box empty to show nothing. Links must be full web addresses starting with https://.
          </p>
          {SOCIAL_NETWORKS.map((n) => (
            <LabeledInput
              key={n.id}
              label={`${n.label} link`}
              type="url"
              inputMode="url"
              {...register(`${n.id}Url` as "facebookUrl" | "instagramUrl" | "googleUrl" | "nextdoorUrl")}
            />
          ))}
          <div>
            <LabeledInput label="Logo address (for printed invoices and work orders)" {...register("logoUrl")} />
            <p className="mt-1 text-xs text-ink-soft">
              One of {BRAND_LOGO_FILES.join(", ")}, or the address of a picture (PNG or JPG) uploaded to your own file
              storage. Pictures from other websites are blocked by the site&apos;s security rules, so they would not
              show. Leave empty to print the business name only.
            </p>
          </div>
        </fieldset>
      )}

      {(!section || section === "service-area") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-ink">
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
          <legend className="text-base font-semibold text-ink">
            Fees
          </legend>
          <p className="text-sm text-ink-soft">
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
          <Checkbox
            label="Require a refundable security deposit"
            {...register("depositEnabled")}
          />
          <Checkbox
            label="Offer an optional damage waiver"
            {...register("damageWaiverEnabled")}
          />
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
          <legend className="text-base font-semibold text-ink">
            Prepaid-term discounts
          </legend>
          <p className="text-sm text-ink-soft">
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
          <Checkbox
            label="Also give a free month when a customer pays the full 12-month term in one lump sum up front (you mark this yourself when creating that agreement)"
            {...register("twelveMonthPrepayFreeMonthEnabled")}
          />
        </fieldset>
      )}

      {(!section || section === "policies") && (
        <fieldset className="space-y-4">
          <legend className="text-base font-semibold text-ink">
            Referral program
          </legend>
          <p className="text-sm text-ink-soft">
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
          <legend className="text-base font-semibold text-ink">
            Reserved-appliance holds
          </legend>
          <p className="text-sm text-ink-soft">
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
          <legend className="text-base font-semibold text-ink">
            Sales tax
          </legend>
          <p className="text-sm text-ink-soft">
            Defaults to 0% until confirmed with a CPA — never guess a tax rate
            (see docs/BUSINESS-RULES.md).
          </p>
          <LabeledInput
            label="Tax rate (%, up to three decimals — e.g. 7.375)"
            type="text"
            inputMode="decimal"
            {...register("taxRatePercentText")}
          />
          <Checkbox
            label="A CPA has confirmed this rate is correct"
            {...register("taxRateConfirmed")}
          />
        </fieldset>
      )}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting
          ? "Saving…"
          : section
            ? "Save this section"
            : "Save settings"}
      </Button>
    </form>
  );
}

const DollarInput = forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string }
>(function DollarInput({ label, className = "", ...props }, ref) {
  const id = `settings-${props.name}`;
  return (
    <div className="max-w-sm">
      <Field
        ref={ref}
        id={id}
        label={label}
        type="number"
        min={0}
        step="0.01"
        {...props}
        className={className}
      />
    </div>
  );
});

const LabeledInput = forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement> & { label: string }
>(function LabeledInput({ label, className = "", ...props }, ref) {
  const id = `settings-${props.name}`;
  return (
    <div className="max-w-sm">
      <Field
        ref={ref}
        id={id}
        label={label}
        {...props}
        className={className}
      />
    </div>
  );
});
