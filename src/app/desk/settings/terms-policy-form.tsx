"use client";

import { useState } from "react";
import { updateTermsPolicyAction } from "./actions";
import type { TermsPolicyFormValues } from "@/domains/settings/terms-policy";
import { RECOMMENDED_TERMS_POLICY } from "@/domains/settings/recommended-terms";

const inputClass = "w-full max-w-sm rounded-lg border border-gray-300 px-3 py-2 text-sm";

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
          className={`rounded-lg px-4 py-3 text-sm ${
            message.kind === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
          }`}
        >
          {message.text}
        </p>
      )}

      <p className="rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900">
        The starting values here come from common practice for equipment rentals and Colorado&rsquo;s
        automatic-renewal law (a reminder 25 to 40 days before a renewal, and an easy way to
        cancel). Every number and sentence is yours to change. Owners and admins can edit this
        section. Please have a Colorado attorney read the wording before you rely on it.
      </p>

      <p className="rounded-lg border border-gray-300 px-4 py-3 text-sm text-gray-900">
        Changes here apply only to rental agreements that are sent for signing <strong>after</strong> you
        save. Every agreement already sent keeps the terms it was sent with, so changing these never
        changes a customer&rsquo;s current 6- or 12-month rental.
      </p>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">Ending a rental early</legend>
        <p className="text-sm text-gray-600">
          What a customer owes if they end a 6- or 12-month rental before the term is up. A rental
          can only end on its monthly billing date. Leave a box empty if you have not decided yet;
          nothing is charged until every needed box is filled in.
        </p>

        <div>
          <label htmlFor="terms-feeDollars" className="mb-1 block text-sm font-medium text-gray-900">
            Flat fee
          </label>
          <div className="flex max-w-sm items-center gap-2">
            <span aria-hidden="true" className="text-gray-500">
              $
            </span>
            <input
              id="terms-feeDollars"
              inputMode="decimal"
              value={values.feeDollars}
              onChange={change("feeDollars")}
              aria-describedby="terms-fee-help"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label htmlFor="terms-feePercent" className="mb-1 block text-sm font-medium text-gray-900">
            Percent of the rent still owed
          </label>
          <div className="flex max-w-sm items-center gap-2">
            <input
              id="terms-feePercent"
              inputMode="numeric"
              value={values.feePercent}
              onChange={change("feePercent")}
              aria-describedby="terms-fee-help"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
            <span aria-hidden="true" className="text-gray-500">
              %
            </span>
          </div>
          <p id="terms-fee-help" className="mt-1 text-xs text-gray-600">
            Fill in one or both. If you fill in both, the customer pays whichever comes out larger.
            Enter 0 if there should be no fee.
          </p>
        </div>
        <div>
          <label htmlFor="terms-feeCapDollars" className="mb-1 block text-sm font-medium text-gray-900">
            Highest fee you will ever charge (optional)
          </label>
          <div className="flex max-w-sm items-center gap-2">
            <span aria-hidden="true" className="text-gray-500">
              $
            </span>
            <input
              id="terms-feeCapDollars"
              inputMode="decimal"
              value={values.feeCapDollars}
              onChange={change("feeCapDollars")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
        <div>
          <label htmlFor="terms-noticeDays" className="mb-1 block text-sm font-medium text-gray-900">
            Days of notice the customer must give
          </label>
          <input
            id="terms-noticeDays"
            inputMode="numeric"
            value={values.noticeDays}
            onChange={change("noticeDays")}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="terms-unusedTerm" className="mb-1 block text-sm font-medium text-gray-900">
            If a customer prepaid, what happens to the months they did not use?
          </label>
          <select
            id="terms-unusedTerm"
            value={values.unusedTerm}
            onChange={change("unusedTerm")}
            className={inputClass}
          >
            <option value="">Not decided yet</option>
            <option value="REFUND">Refund it to the customer</option>
            <option value="CREDIT">Give it as account credit</option>
            <option value="RETAIN">Keep it (no refund)</option>
          </select>
        </div>
        <div>
          <label htmlFor="terms-terminationTermsText" className="mb-1 block text-sm font-medium text-gray-900">
            Wording customers will see about ending early
          </label>
          <textarea
            id="terms-terminationTermsText"
            rows={5}
            value={values.terminationTermsText}
            onChange={change("terminationTermsText")}
            className="w-full max-w-xl rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="text-base font-semibold text-gray-900">Automatic renewal</legend>
        <p className="text-sm text-gray-600">
          Lets a customer agree to renew automatically. It stays off until both boxes below are
          filled in. If you change the wording, customers who agreed earlier keep the wording they
          agreed to, and new agreements use the new wording.
        </p>
        <div>
          <label htmlFor="terms-autoRenewNoticeDays" className="mb-1 block text-sm font-medium text-gray-900">
            Days before the term ends that the customer is told it will renew
          </label>
          <input
            id="terms-autoRenewNoticeDays"
            inputMode="numeric"
            value={values.autoRenewNoticeDays}
            onChange={change("autoRenewNoticeDays")}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="terms-renewalTermsText" className="mb-1 block text-sm font-medium text-gray-900">
            Wording customers will see when they agree to renew
          </label>
          <textarea
            id="terms-renewalTermsText"
            rows={5}
            value={values.renewalTermsText}
            onChange={change("renewalTermsText")}
            className="w-full max-w-xl rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
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
            setValues(RECOMMENDED_TERMS_POLICY);
            setMessage({
              kind: "success",
              text: "The recommended starting terms are filled in below. Nothing is saved until you press “Save this section”.",
            });
          }}
          className="rounded-full border border-gray-400 px-5 py-2.5 text-sm font-semibold text-gray-900 disabled:opacity-60"
        >
          Restore recommended starting terms
        </button>
      </div>
    </form>
  );
}
