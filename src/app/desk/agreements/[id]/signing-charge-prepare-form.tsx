"use client";

import { useActionState } from "react";
import {
  prepareSigningChargesAction,
  type PrepareSigningChargeState,
} from "./signing-charge-actions";

const initialState: PrepareSigningChargeState = { ok: false, message: "" };

export function SigningChargePrepareForm({ agreementId }: { agreementId: string }) {
  const [state, action, pending] = useActionState(prepareSigningChargesAction, initialState);
  return (
    <form action={action} className="mt-3 space-y-2">
      <input type="hidden" name="agreementId" value={agreementId} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? "Preparing…" : "Prepare or refresh draft charges"}
      </button>
      {state.message && (
        <p role="status" aria-live="polite" className="text-sm text-ink-soft">
          {state.message}
        </p>
      )}
    </form>
  );
}
