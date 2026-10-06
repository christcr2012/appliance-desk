"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Checkbox, Field } from "@/components/ui";
import { updateSmsPreferenceAction } from "./actions";

export function SmsPreferenceForm({
  initialOptedIn,
  initialPhone,
}: {
  initialOptedIn: boolean;
  initialPhone: string;
}) {
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
      const result = await updateSmsPreferenceAction({ optedIn, phone });
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
        label="Phone number"
        type="tel"
        value={phone}
        onChange={(event) => setPhone(event.target.value)}
        placeholder="(303) 555-0100"
        className="max-w-xs"
      />

      <Checkbox
        id="sms-opt-in"
        label="Text me at the number above for time-sensitive updates, like a reminder on the day of a scheduled delivery or service visit. Message and data rates may apply. Reply STOP at any time to opt out."
        checked={optedIn}
        onChange={(event) => setOptedIn(event.target.checked)}
      />

      {error && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
      {success && !error && (
        <p role="status" className="text-sm font-semibold text-success">
          Saved.
        </p>
      )}

      <Button type="submit" disabled={isPending}>
        {isPending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
