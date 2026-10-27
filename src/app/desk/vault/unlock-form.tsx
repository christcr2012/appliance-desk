"use client";

import { useActionState, useState } from "react";
import { Button, Field } from "@/components/ui";
import { sendUnlockCodeAction, unlockVaultAction, type VaultFormState } from "./actions";

const initial: VaultFormState = { status: "idle" };

/**
 * VAULT-2: the unlock form. The owner proves it's really them with a fresh
 * second-step code — the same methods as sign-in (authenticator app, a code
 * by text or email, or a backup code). Better Auth checks the code; a good
 * code unlocks the vault for this session for 5 minutes.
 */
export function UnlockForm({ defaultMethod }: { defaultMethod: "totp" | "otp" | "backup" }) {
  const [method, setMethod] = useState<"totp" | "otp" | "backup">(defaultMethod);
  const [state, action, pending] = useActionState(unlockVaultAction, initial);
  const [sendState, sendAction, sendPending] = useActionState(
    async () => sendUnlockCodeAction(),
    initial,
  );

  const tab = (value: "totp" | "otp" | "backup", label: string) => (
    <button
      type="button"
      onClick={() => setMethod(value)}
      aria-pressed={method === value}
      className="rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-ink"
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Code type">
        {tab("totp", "Authenticator")}
        {tab("otp", "Text or email code")}
        {tab("backup", "Backup code")}
      </div>
      {method === "otp" && (
        <form action={sendAction}>
          <Button type="submit" variant="secondary" disabled={sendPending}>
            {sendPending ? "Sending…" : "Send me a code"}
          </Button>
          {sendState.status === "sent" && (
            <p className="mt-2 text-sm text-ink-soft">
              If your account gets codes by text or email, one is on its way and works for 5 minutes.
            </p>
          )}
          {sendState.status === "error" && (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">{sendState.message}</p>
          )}
        </form>
      )}
      <form action={action} className="space-y-3">
        <input type="hidden" name="method" value={method} />
        <Field
          label={method === "backup" ? "Backup code" : "Code"}
          name="code"
          inputMode={method === "backup" ? "text" : "numeric"}
          autoComplete="one-time-code"
          placeholder={method === "totp" ? "6-digit code from your app" : method === "otp" ? "6-digit code we sent you" : "One of your backup codes"}
        />
        {state.status === "error" && (
          <p role="alert" className="text-sm font-semibold text-danger">{state.message}</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Unlock the vault for 5 minutes"}
        </Button>
      </form>
    </div>
  );
}
