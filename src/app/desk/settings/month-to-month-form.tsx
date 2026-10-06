"use client";

import { useState } from "react";
import { Button, Field, Textarea } from "@/components/ui";
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
    <form onSubmit={onSubmit} className="mt-8 max-w-2xl space-y-6 border-t border-line pt-6">
      <h3 className="text-base font-semibold text-ink">Month-to-month rentals</h3>
      <p className="text-sm text-ink-soft">
        The days of notice and the wording in “Early-ending terms” above are also the terms for month-to-month rentals.
        {currentVersion ? ` The terms customers are on now are version ${currentVersion}.` : " No terms version is published yet."} When you
        change them, every month-to-month customer gets a notice, and the new terms apply to a customer only after the number
        of days below has passed since their notice was delivered. A customer whose notice was never delivered stays on the old
        terms.
      </p>
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${message.kind === "success" ? "text-success" : "text-danger"}`}
        >
          {message.text}
        </p>
      )}
      <div className="max-w-sm">
        <Field
          id="mtm-days"
          label={`Days before a change applies (${MONTH_TO_MONTH_CHANGE_DAYS_MIN} to ${MONTH_TO_MONTH_CHANGE_DAYS_MAX})`}
          help={`Starting value: ${RECOMMENDED_MONTH_TO_MONTH_CHANGE_DAYS} days, the shortest the owner chose to give customers.`}
          type="text"
          inputMode="numeric"
          value={values.monthToMonthChangeNoticeDays}
          onChange={(event) =>
            setValues({
              ...values,
              monthToMonthChangeNoticeDays: event.target.value,
            })
          }
        />
      </div>
      {(
        [
          ["termsChangeNoticeText", "Terms-change notice wording", "Emailed to each month-to-month customer when the terms change."],
          ["annualReminderText", "Yearly reminder wording", "Emailed once a year to each month-to-month customer, 25 to 40 days before each yearly anniversary (Colorado's automatic-renewal law)."],
        ] as const
      ).map(([key, label, help]) => (
        <div key={key} className="space-y-3">
          <Textarea
            id={`mtm-${key}`}
            label={label}
            help={`${help} Leave it empty to use the starting draft. Words in double braces are filled in for each customer: ${placeholders}.`}
            rows={8}
            placeholder={startingDrafts[key]}
            value={values[key]}
            onChange={(event) =>
              setValues({ ...values, [key]: event.target.value })
            }
          />
          <Button
            type="button"
            variant="secondary"
            onClick={() => setValues({ ...values, [key]: "" })}
          >
            Restore recommended wording
          </Button>
        </div>
      ))}
      <Button type="submit" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
