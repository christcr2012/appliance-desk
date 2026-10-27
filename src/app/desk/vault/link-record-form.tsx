"use client";

import { useActionState } from "react";
import { Button, Select } from "@/components/ui";
import { linkRecordAction, type VaultFormState } from "./actions";
import type { LinkableRecord } from "@/domains/vault";

const initial: VaultFormState = { status: "idle" };

/** VAULT-2: pick a business record to link to this login (used on the login page). */
export function LinkRecordForm({
  credentialId,
  records,
}: {
  credentialId: string;
  records: LinkableRecord[];
}) {
  const [state, formAction, pending] = useActionState(linkRecordAction.bind(null, credentialId), initial);
  return (
    <form action={formAction} className="mt-4 space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-56 flex-1">
          <Select label="Link a record" name="recordId">
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
                {r.linkedCredentialTitle ? ` (currently: ${r.linkedCredentialTitle})` : ""}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? "Linking…" : "Link record"}
        </Button>
      </div>
      {state.status === "error" && (
        <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
      )}
    </form>
  );
}
