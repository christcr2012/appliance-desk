"use client";

import { useState } from "react";
import { updateMonthToMonthSettingsAction } from "./actions";
import {
  MONTH_TO_MONTH_CHANGE_DAYS_MAX,
  MONTH_TO_MONTH_CHANGE_DAYS_MIN,
  RECOMMENDED_MONTH_TO_MONTH_CHANGE_DAYS,
  type MonthToMonthSettingsValues,
} from "@/domains/settings/month-to-month";
import { WORDING_PLACEHOLDERS } from "@/domains/notices/wording";

/** Month-to-month notices, explained on the screen itself. */
export function MonthToMonthForm({
  defaultValues,
  currentVersion,
  startingDrafts,
}: {
  defaultValues: MonthToMonthSettingsValues;
  currentVersion: number | null;
  startingDrafts: { termsChangeNoticeText: string; annualReminderText: string };
}) {
  const [values, setValues] = useState<MonthToMonthSettingsValues>(defaultValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateMonthToMonthSettingsAction(values);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Saved. It applies to notices created from now on." }
          : result.status === "error"
            ? { kind: "error", text: result.message }
            : null,
      );
    } catch {
      setMessage({ kind: "error", text: "Settings could not be saved. Your changes are still in the form; please try again." });
    } finally {
      setSaving(false);
    }
  }

  const placeholders = WORDING_PLACEHOLDERS.map((p) => `{{${p}}}`).join(" ");

  return (
    <form onSubmit={onSubmit} className="mt-8 max-w-2xl space-y-6 border-t border-gray-200 pt-6">
      <h3 className="text-base font-semibold text-gray-900">Month-to-month rentals</h3>
      <p className="text-sm text-gray-600">
        The days of notice and the wording in “Early-ending terms” above are also the terms for month-to-month rentals.
        {currentVersion ? ` The terms customers are on now are version ${currentVersion}.` : " No terms version is published yet."} When you
        change them, every month-to-month customer gets a notice, and the new terms apply to a customer only after the number
        of days below has passed since their notice was delivered. A customer whose notice was never delivered stays on the old
        terms.
      </p>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-lg px-4 py-3 text-sm ${message.kind === "success" ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}
        >
          {message.text}
        </p>
      )}
      <div className="space-y-2">
        <label htmlFor="mtm-days" className="block text-sm font-medium text-gray-900">
          Days before a change applies ({MONTH_TO_MONTH_CHANGE_DAYS_MIN} to {MONTH_TO_MONTH_CHANGE_DAYS_MAX})
        </label>
        <p className="text-sm text-gray-600">Starting value: {RECOMMENDED_MONTH_TO_MONTH_CHANGE_DAYS} days, the shortest the owner chose to give customers.</p>
        <input
          id="mtm-days"
          type="text"
          inputMode="numeric"
          className="w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm"
          value={values.monthToMonthChangeNoticeDays}
          onChange={(e) => setValues({ ...values, monthToMonthChangeNoticeDays: e.target.value })}
        />
      </div>
      {(
        [
          ["termsChangeNoticeText", "Terms-change notice wording", "Emailed to each month-to-month customer when the terms change."],
          ["annualReminderText", "Yearly reminder wording", "Emailed once a year to each month-to-month customer, 25 to 40 days before each yearly anniversary (Colorado's automatic-renewal law)."],
        ] as const
      ).map(([key, label, help]) => (
        <div key={key} className="space-y-2">
          <label htmlFor={`mtm-${key}`} className="block text-sm font-medium text-gray-900">
            {label}
          </label>
          <p className="text-sm text-gray-600">
            {help} Leave it empty to use the starting draft. Words in double braces are filled in for each customer: {placeholders}.
          </p>
          <textarea
            id={`mtm-${key}`}
            rows={8}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            placeholder={startingDrafts[key]}
            value={values[key]}
            onChange={(e) => setValues({ ...values, [key]: e.target.value })}
          />
          <button type="button" className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm text-gray-900" onClick={() => setValues({ ...values, [key]: "" })}>
            Restore recommended wording
          </button>
        </div>
      ))}
      <button type="submit" disabled={saving} className="rounded-full bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
        {saving ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
