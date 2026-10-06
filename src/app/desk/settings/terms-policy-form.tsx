"use client";

import { useState } from "react";
import { Button, Field, Select, Textarea } from "@/components/ui";
import { updateTermsPolicyAction } from "./actions";
import type { TermsPolicyFormValues } from "@/domains/settings/terms-policy";
import { RECOMMENDED_TERMS_POLICY } from "@/domains/settings/recommended-terms";


export function TermsPolicyForm({ defaultValues }: { defaultValues: TermsPolicyFormValues }) {
  const [values, setValues] = useState<TermsPolicyFormValues>(defaultValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  function change(field: keyof TermsPolicyFormValues) {
    return (
      event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
    ) => setValues((current) => ({ ...current, [field]: event.target.value }));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateTermsPolicyAction(values);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Settings saved." }
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
        The starting values here come from common practice for equipment rentals and Colorado&rsquo;s
        automatic-renewal law (a reminder 25 to 40 days before a renewal, and an easy way to
        cancel). Every number and sentence is yours to change. Owners and admins can edit this
        section. Please have a Colorado attorney read the wording before you rely on it.
      </p>

      <p className="rounded-card border border-line bg-subtle px-4 py-3 text-sm text-ink">
        Changes here apply only to rental agreements that are sent for signing <strong>after</strong> you
        save. Every agreement already sent keeps the terms it was sent with, so changing these never
        changes a customer&rsquo;s current 6- or 12-month rental.
      </p>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">Ending a rental early</legend>
        <p className="text-sm text-ink-soft">
          What a customer owes if they end a 6- or 12-month rental before the term is up. A rental
          can only end on its monthly billing date. Leave a box empty if you have not decided yet;
          nothing is charged until every needed box is filled in.
        </p>

        <div className="max-w-sm">
          <Field
            id="terms-feeDollars"
            label="Flat fee"
            inputMode="decimal"
            value={values.feeDollars}
            onChange={change("feeDollars")}
          />
        </div>
        <div className="max-w-sm">
          <Field
            id="terms-feePercent"
            label="Percent of the rent still owed"
            help="Fill in one or both. If you fill in both, the customer pays whichever comes out larger. Enter 0 if there should be no fee."
            inputMode="numeric"
            value={values.feePercent}
            onChange={change("feePercent")}
          />
        </div>
        <div className="max-w-sm">
          <Field
            id="terms-feeCapDollars"
            label="Highest fee you will ever charge (optional)"
            inputMode="decimal"
            value={values.feeCapDollars}
            onChange={change("feeCapDollars")}
          />
        </div>
        <div className="max-w-sm">
          <Field
            id="terms-noticeDays"
            label="Days of notice the customer must give"
            inputMode="numeric"
            value={values.noticeDays}
            onChange={change("noticeDays")}
          />
        </div>
        <div className="max-w-sm">
          <Select
            id="terms-unusedTerm"
            label="If a customer prepaid, what happens to the months they did not use?"
            value={values.unusedTerm}
            onChange={change("unusedTerm")}
          >
            <option value="">Not decided yet</option>
            <option value="REFUND">Refund it to the customer</option>
            <option value="CREDIT">Give it as account credit</option>
            <option value="RETAIN">Keep it (no refund)</option>
          </Select>
        </div>
        <div className="max-w-xl">
          <Textarea
            id="terms-terminationTermsText"
            label="Wording customers will see about ending early"
            rows={5}
            value={values.terminationTermsText}
            onChange={change("terminationTermsText")}
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-ink">Automatic renewal</legend>
        <p className="text-sm text-ink-soft">
          Lets a customer agree to renew automatically. It stays off until both boxes below are
          filled in. If you change the wording, customers who agreed earlier keep the wording they
          agreed to, and new agreements use the new wording.
        </p>
        <div className="max-w-sm">
          <Field
            id="terms-autoRenewNoticeDays"
            label="Days before the term ends that the customer is told it will renew (25 to 40)"
            inputMode="numeric"
            value={values.autoRenewNoticeDays}
            onChange={change("autoRenewNoticeDays")}
          />
        </div>
        <div className="max-w-xl">
          <Textarea
            id="terms-renewalTermsText"
            label="Wording customers will see when they agree to renew"
            rows={5}
            value={values.renewalTermsText}
            onChange={change("renewalTermsText")}
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
            setValues(RECOMMENDED_TERMS_POLICY);
            setMessage({
              kind: "success",
              text: "The recommended starting terms are filled in below. Nothing is saved until you press “Save this section”.",
            });
          }}
        >
          Restore recommended starting terms
        </Button>
      </div>
    </form>
  );
}
