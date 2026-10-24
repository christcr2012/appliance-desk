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
  const [mode, setMode] = useState<"totp" | "otp" | "backup">("totp");
  const [sentNote, setSentNote] = useState<string | null>(null);
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
        : mode === "otp"
          ? await authClient.twoFactor.verifyOtp({ code: value.trim(), trustDevice: false })
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

  async function sendCode() {
    setError(null);
    setSentNote(null);
    setBusy(true);
    const result = await authClient.twoFactor.sendOtp();
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "We could not send a code. Try your authenticator app or a backup code.");
      return;
    }
    // The answer is the same whichever method the account uses; only the stored choice decides where a code goes.
    setSentNote("If your account gets codes by text or email, one is on its way and works for 5 minutes. If nothing arrives, use your authenticator app or a backup code.");
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Code type">
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
          onClick={() => { setMode("otp"); setValue(""); setError(null); }}
          aria-pressed={mode === "otp"}
          className="rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-ink"
        >
          Text or email code
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
        {mode === "totp" ? "6-digit authenticator code" : mode === "otp" ? "6-digit code we sent you" : "Single-use backup code"}
      </label>
      {mode === "otp" && (
        <div className="space-y-2">
          <button type="button" disabled={busy} onClick={sendCode} className="rounded-control border border-line-strong px-3 py-2 text-sm font-medium text-ink disabled:opacity-50">
            Send me a code
          </button>
          {sentNote && <p role="status" className="text-sm text-ink-soft">{sentNote}</p>}
        </div>
      )}
      <input
        id="two-factor-login-code"
        autoComplete="one-time-code"
        inputMode={mode === "backup" ? "text" : "numeric"}
        required
        value={value}
        onChange={(event) =>
          setValue(
            mode === "backup"
              ? event.target.value
              : event.target.value.replace(/\D/g, "").slice(0, 6),
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
