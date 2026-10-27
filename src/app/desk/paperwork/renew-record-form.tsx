"use client";

import { useActionState } from "react";
import { Button, Field } from "@/components/ui";
import { renewRecordAction, type RecordActionState } from "./record-actions";

/** VAULT-1: the "Renewed…" form — new expiry (and next action date, if it differs). */
export function RenewRecordForm({
  recordId,
  expectedVersion,
  currentExpiresOn,
  currentDueOn,
}: {
  recordId: string;
  expectedVersion: number;
  currentExpiresOn: string;
  currentDueOn: string;
}) {
  const [state, formAction, pending] = useActionState(
    renewRecordAction.bind(null, recordId, expectedVersion),
    { status: "idle" } as RecordActionState,
  );
  return (
    <form action={formAction} className="max-w-2xl space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="New expiry date"
          name="expiresOn"
          type="date"
          defaultValue=""
          help={currentExpiresOn ? `Currently ${currentExpiresOn}. Leave blank to advance by the repeat length.` : "The date on the new document."}
        />
        <Field
          label="New next-action date (if different)"
          name="dueOn"
          type="date"
          defaultValue=""
          help={currentDueOn ? `Currently ${currentDueOn}.` : "Usually the same as the expiry."}
        />
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
      )}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Renewed — save the new dates"}</Button>
    </form>
  );
}
