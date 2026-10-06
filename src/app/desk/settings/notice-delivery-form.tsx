"use client";

import { useState } from "react";
import { Button, Field, Select } from "@/components/ui";
import { updateNoticeDeliveryAction } from "./actions";
import {
  RECOMMENDED_MAIL_NOTICE_TRANSIT_DAYS,
  RECOMMENDED_NOTICE_CERTIFIER,
  type NoticeDeliveryValues,
} from "@/domains/settings/notice-delivery";

/** "Recording a delivered notice" settings, explained on the screen itself. Only the owner can change them. */
export function NoticeDeliveryForm({ defaultValues, canChange }: { defaultValues: NoticeDeliveryValues; canChange: boolean }) {
  const [values, setValues] = useState<NoticeDeliveryValues>(defaultValues);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    setSaving(true);
    try {
      const result = await updateNoticeDeliveryAction(values);
      setMessage(
        result.status === "success"
          ? { kind: "success", text: "Saved. It applies to every delivery you record from now on." }
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

  return (
    <form onSubmit={onSubmit} className="mt-8 max-w-2xl space-y-6 border-t border-line pt-6">
      <h3 className="text-base font-semibold text-ink">Recording a reminder you delivered yourself</h3>
      {!canChange && <p className="text-sm text-ink-soft">Only the owner can change these two settings.</p>}
      {message && (
        <p
          role={message.kind === "error" ? "alert" : "status"}
          className={`rounded-control border border-line bg-subtle px-4 py-3 text-sm font-medium ${message.kind === "success" ? "text-success" : "text-danger"}`}
        >
          {message.text}
        </p>
      )}
      <fieldset className="space-y-3" disabled={!canChange}>
        <legend className="text-sm font-semibold text-ink">Who may record a delivery</legend>
        <p className="text-sm text-ink-soft">
          When a renewal reminder could not be emailed, someone can record that it was delivered another way (mail, your
          business mailbox, a printed copy, or a text the customer agreed to). That record decides whether the renewal may
          start, so it is a legal statement. “Owner only” means only you can make it; “Owner and admins” lets admins do it too.
          Starting value: owner only, the safest choice.
        </p>
        <Select
          id="notice-certifier"
          label="Who can record it"
          value={values.noticeCertifierRoles}
          onChange={(event) =>
            setValues({
              ...values,
              noticeCertifierRoles: event.target.value as NoticeDeliveryValues["noticeCertifierRoles"],
            })
          }
        >
          <option value="OWNER">Owner only</option>
          <option value="OWNER_AND_ADMIN">Owner and admins</option>
        </Select>
      </fieldset>
      <fieldset className="space-y-3" disabled={!canChange}>
        <legend className="text-sm font-semibold text-ink">Days for mailed notices to arrive</legend>
        <p className="text-sm text-ink-soft">
          A reminder you mail counts as delivered this many days after the day you mailed it, so the allowed 25 to 40 days
          are counted from when the customer most likely got it. Use 0 to count the mailing day itself. Starting value: 3
          days, a cautious guess for regular first-class mail. Your attorney can confirm the right number.
        </p>
        <div className="max-w-xs">
          <Field
            id="notice-transit"
            label="Days (0 to 14)"
            type="text"
            inputMode="numeric"
            value={values.mailNoticeTransitDays}
            onChange={(event) =>
              setValues({ ...values, mailNoticeTransitDays: event.target.value })
            }
          />
        </div>
      </fieldset>
      {canChange && (
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() =>
              setValues({
                noticeCertifierRoles: RECOMMENDED_NOTICE_CERTIFIER,
                mailNoticeTransitDays: String(RECOMMENDED_MAIL_NOTICE_TRANSIT_DAYS),
              })
            }
          >
            Restore recommended values (owner only, {RECOMMENDED_MAIL_NOTICE_TRANSIT_DAYS} days)
          </Button>
        </div>
      )}
    </form>
  );
}
