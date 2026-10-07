"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  authClient,
  LOGIN_NEXT_STORAGE_KEY,
} from "@/lib/auth-client";
import { getPostLoginDestination } from "../actions";

export function TwoFactorLoginForm() {
  const router = useRouter();
  const [mode, setMode] = useState<"totp" | "backup">("totp");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function finishLogin() {
    const next =
      typeof window === "undefined"
        ? null
        : sessionStorage.getItem(LOGIN_NEXT_STORAGE_KEY);
    const destination = await getPostLoginDestination(next);
    sessionStorage.removeItem(LOGIN_NEXT_STORAGE_KEY);
    router.push(destination);
    router.refresh();
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result =
      mode === "totp"
        ? await authClient.twoFactor.verifyTotp({
            code: value.trim(),
            trustDevice: false,
          })
        : await authClient.twoFactor.verifyBackupCode({
            code: value.trim(),
            trustDevice: false,
          });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That code was not accepted.");
      return;
    }
    await finishLogin();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="Code type">
        <button
          type="button"
          onClick={() => { setMode("totp"); setValue(""); setError(null); }}
          aria-pressed={mode === "totp"}
          className="rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-ink"
        >
          Authenticator
        </button>
        <button
          type="button"
          onClick={() => { setMode("backup"); setValue(""); setError(null); }}
          aria-pressed={mode === "backup"}
          className="rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-ink"
        >
          Backup code
        </button>
      </div>
      <label htmlFor="two-factor-login-code" className="block text-sm font-medium text-ink">
        {mode === "totp" ? "6-digit authenticator code" : "Single-use backup code"}
      </label>
      <input
        id="two-factor-login-code"
        autoComplete="one-time-code"
        inputMode={mode === "totp" ? "numeric" : "text"}
        required
        value={value}
        onChange={(event) =>
          setValue(
            mode === "totp"
              ? event.target.value.replace(/\D/g, "").slice(0, 6)
              : event.target.value,
          )
        }
        className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink"
      />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button
        type="submit"
        disabled={busy || !value.trim()}
        className="w-full rounded-control bg-primary px-4 py-2 font-medium text-on-primary disabled:opacity-50"
      >
        {busy ? "Checking…" : "Continue"}
      </button>
    </form>
  );
}
