"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, Field } from "@/components/ui";
import { setRetiredFollowUpDaysAction } from "../retired-actions";

/** How long a retired appliance can wait before Today reminds you. Starts at 30 days; 0 turns it off. */
export function ReminderSetting({ days }: { days: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [value, setValue] = useState(String(days));
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    start(async () => {
      const result = await setRetiredFollowUpDaysAction(Number(value));
      if (result.status === "error") return setMessage({ ok: false, text: result.message });
      setMessage({ ok: true, text: "Saved." });
      router.refresh();
    });
  }

  return (
    <form onSubmit={save} className="grid gap-2 rounded-card border border-line bg-surface p-4 sm:max-w-md">
      <Field
        id="retired-reminder-days"
        label="Remind me after this many days"
        type="number" min={0} max={365} step={1}
        value={value} onChange={(e) => setValue(e.target.value)}
        help="Today shows one reminder when a retired appliance has had no decision, or isn't finished, for this long. Starts at 30. Enter 0 to never remind."
        required
      />
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {message && <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold ${message.ok ? "text-ink" : "text-danger"}`}>{message.text}</p>}
      </div>
    </form>
  );
}
