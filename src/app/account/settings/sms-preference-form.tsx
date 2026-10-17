"use client";

import { useCustomerTranslation, useCustomerLanguage } from "@/domains/language/client-portal";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field } from "@/components/ui";
import { updateSmsPreferenceAction } from "./actions";
import { PORTAL_SMS_DISCLOSURE, PORTAL_SMS_DISCLOSURE_ES } from "@/domains/messaging/portal-disclosure";

export function SmsPreferenceForm({
  initialOptedIn,
  initialPhone,
}: {
  initialOptedIn: boolean;
  initialPhone: string;
}) {
  const language = useCustomerLanguage();
  const tr = useCustomerTranslation();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optedIn, setOptedIn] = useState(initialOptedIn);
  const [phone, setPhone] = useState(initialPhone);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSuccess(false);

    startTransition(async () => {
      const result = await updateSmsPreferenceAction({ optedIn, phone, disclosureLanguage: language });
      if (result.status === "error") {
        setError(result.message);
      } else {
        setSuccess(true);
        router.refresh();
      }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field
        id="sms-phone"
        label={tr("Phone number")}
        type="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="(303) 555-0100"
        className="max-w-xs"
      />

      <Checkbox
        id="sms-opt-in"
        label={language === "es" ? PORTAL_SMS_DISCLOSURE_ES : PORTAL_SMS_DISCLOSURE}
        checked={optedIn}
        onChange={(event) => setOptedIn(event.target.checked)}
      />

      <p className="text-xs text-ink-soft">{tr("Turning on this preference does not start texts until the business is approved for messaging and your phone can be verified. Your choice is not marketing consent.")}</p>
      <p className="text-xs text-ink-soft">
        <a href="/privacy" className="underline">{tr("Privacy policy")}</a>
        {" · "}
        <a href="/terms" className="underline">{tr("Terms")}</a>
      </p>

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {language === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
      {success && !error && (
        <p role="status" className="text-sm font-semibold text-success">{tr("Saved.")}</p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? tr("Saving…") : tr("Save")}
      </Button>
    </form>
  );
}
