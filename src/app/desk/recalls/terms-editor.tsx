"use client";

import { useState, useTransition } from "react";
import { Button, Field } from "@/components/ui";
import { saveRecallTermsAction } from "./actions";

/** The words used to search the recall list for one kind of appliance. Starts as the kind's name. */
export function TermsEditor({ typeId, typeName, initial, fallback }: { typeId: string; typeName: string; initial: string; fallback: string }) {
  const [value, setValue] = useState(initial);
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  function save(event: React.FormEvent) {
    event.preventDefault();
    setMessage(null);
    start(async () => {
      const result = await saveRecallTermsAction(typeId, value);
      setMessage(result.status === "error" ? { ok: false, text: result.message } : { ok: true, text: "Saved." });
    });
  }
  return (
    <form onSubmit={save} className="grid gap-2 sm:max-w-md">
      <Field
        id={`recall-terms-${typeId}`}
        label={`${typeName}: search words`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={fallback}
        help="Separate words with commas, for example: washer, washing machine."
      />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Saving…" : "Save"}</Button>
        {message && <p role={message.ok ? "status" : "alert"} className={`text-sm font-semibold ${message.ok ? "text-ink" : "text-danger"}`}>{message.text}</p>}
      </div>
    </form>
  );
}
