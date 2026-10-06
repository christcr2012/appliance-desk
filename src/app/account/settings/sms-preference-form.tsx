"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      <div>
        <label htmlFor="sms-phone" className="block text-sm font-medium text-ink">
          Phone number
        </label>
        <input
          id="sms-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="(303) 555-0100"
          className="mt-1 w-full max-w-xs rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>

      <label className="flex items-start gap-3 text-sm text-ink-soft">
        <input
          type="checkbox"
          checked={optedIn}
          onChange={(e) => setOptedIn(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          Text me at the number above for time-sensitive updates, like a reminder on the day
          of a scheduled delivery or service visit. Message and data rates may apply. Reply
          STOP at any time to opt out.
        </span>
      </label>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {success && !error && (
        <p role="status" className="text-sm text-green-700">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending ? "Saving…" : "Save"}
      </button>
    </form>
  );
}
