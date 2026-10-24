"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { METHOD_LABEL, type SecondStepMethod } from "@/domains/security/second-step-rules";
import { chooseMethodAction, codeDeliveryAction, confirmPhoneAction, savePhoneInSetupAction, startPhoneCheckAction } from "../actions";

type SetupData = {
  totpURI: string;
  backupCodes: string[];
};

function secretFromUri(uri: string): string {
  try {
    return new URL(uri).searchParams.get("secret") ?? "";
  } catch {
    return "";
  }
}

type MethodInfo = { allowed: SecondStepMethod[]; textCodesReady: boolean; phone: string | null; phoneConfirmed: boolean };

export function TwoFactorSetupForm({ info }: { info: MethodInfo }) {
  const router = useRouter();
  const [method, setMethod] = useState<SecondStepMethod | null>(info.allowed.length === 1 ? info.allowed[0]! : null);
  const [chosen, setChosen] = useState(false);
  const [phoneChecked, setPhoneChecked] = useState(info.phoneConfirmed);
  const [savedPhone, setSavedPhone] = useState<string | null>(info.phone);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneSent, setPhoneSent] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Ask for a code and say honestly whether it went out (the library cannot tell us; our delivery record can). */
  async function requestCode(which: SecondStepMethod) {
    setBusy(true);
    const sent = await authClient.twoFactor.sendOtp();
    if (sent.error) { setBusy(false); setError(sent.error.message ?? "We could not send a code. Try again."); return; }
    const delivery = await codeDeliveryAction();
    setBusy(false);
    if (delivery.status === "success" && delivery.message === "sent") {
      setError(null);
      setNote(which === "SMS" ? "We sent a code to your phone." : "We sent a code to your email.");
    } else if (delivery.status === "success" && delivery.message === "unknown") {
      setError(null);
      setNote("We asked for a code. If nothing arrives in a minute, use Send a new code.");
    } else {
      setNote(null);
      setError("We could not send the code. Use Send a new code, or go back and choose another method.");
    }
  }

  function backToMethods() {
    setError(null); setNote(null); setSetup(null); setChosen(false); setMethod(info.allowed.length === 1 ? info.allowed[0]! : null); setPhoneSent(false);
  }

  async function savePhone(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await savePhoneInSetupAction(phoneInput);
    setBusy(false);
    if (result.status === "error") { setError(result.message); return; }
    setSavedPhone(phoneInput);
    setNote(null);
  }

  async function begin(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authClient.twoFactor.enable({
      password,
      method: "totp",
      issuer: "Robinson Appliance Rentals",
    });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Could not start authenticator setup.");
      return;
    }
    const data = result.data as
      | { method: "totp"; totpURI: string; backupCodes: string[] }
      | { method: "otp" }
      | null;
    if (!data || data.method !== "totp") {
      setError("Authenticator setup did not return a TOTP secret.");
      return;
    }
    setSetup({ totpURI: data.totpURI, backupCodes: data.backupCodes });
    if (method === "SMS" || method === "EMAIL") {
      // Prove the new method works before it is relied on: send a code now; entering it turns two-step on.
      await requestCode(method);
    }
  }

  async function chooseMethod(next: SecondStepMethod) {
    setError(null);
    // Text codes: the phone is checked first, and the choice is saved only once it has been (see checkPhone).
    if (next === "SMS" && !phoneChecked) { setMethod(next); setChosen(true); return; }
    setBusy(true);
    const result = await chooseMethodAction(next);
    setBusy(false);
    if (result.status === "error") { setError(result.message); return; }
    setMethod(next);
    setChosen(true);
  }

  async function sendPhoneCode() {
    setError(null);
    setBusy(true);
    const result = await startPhoneCheckAction();
    setBusy(false);
    if (result.status === "error") setError(result.message);
    else { setPhoneSent(true); setNote(result.message ?? null); }
  }

  async function checkPhone(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await confirmPhoneAction(phoneCode);
    if (result.status === "error") { setBusy(false); setError(result.message); return; }
    const saved = await chooseMethodAction("SMS");
    setBusy(false);
    if (saved.status === "error") { setError(saved.message); return; }
    setPhoneChecked(true);
    setNote(null);
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = method === "TOTP"
      ? await authClient.twoFactor.verifyTotp({ code: code.trim(), trustDevice: false })
      : await authClient.twoFactor.verifyOtp({ code: code.trim(), trustDevice: false });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "That code was not accepted.");
      return;
    }
    setVerified(true);
  }

  if (verified && setup) {
    return (
      <div className="space-y-4">
        <p role="status" className="text-sm font-medium text-success">
          Two-step login is on. Save these single-use backup codes now.
        </p>
        <ul
          data-testid="two-factor-backup-codes"
          className="grid gap-2 rounded-card border border-line bg-subtle p-4 font-mono text-sm sm:grid-cols-2"
        >
          {setup.backupCodes.map((backupCode) => (
            <li key={backupCode}>{backupCode}</li>
          ))}
        </ul>
        <p className="text-sm text-ink-soft">
          Store them somewhere safe away from your phone. Each code works once.
        </p>
        <button
          type="button"
          onClick={() => {
            router.push("/desk/today");
            router.refresh();
          }}
          className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary"
        >
          I saved my backup codes
        </button>
      </div>
    );
  }

  if (!chosen && !setup) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-ink-soft">Choose how you want to get your second step after your password.</p>
        <div className="space-y-2" role="group" aria-label="Second-step method">
          {info.allowed.map((m) => {
            const unavailable = m === "SMS" && !info.textCodesReady;
            return (
              <button
                key={m}
                type="button"
                disabled={busy || unavailable}
                onClick={() => chooseMethod(m)}
                className="block w-full rounded-control border border-line-strong px-3 py-2 text-left text-sm font-medium text-ink disabled:opacity-50"
              >
                {METHOD_LABEL[m]}
                {unavailable && <span className="block text-xs font-normal text-ink-soft">Not switched on yet.</span>}
              </button>
            );
          })}
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    );
  }

  if (chosen && method === "SMS" && !phoneChecked && !setup) {
    if (!savedPhone) {
      return (
        <form onSubmit={savePhone} className="space-y-4">
          <p className="text-sm text-ink-soft">Enter your mobile phone number. We will text it a code to check it is yours.</p>
          <label className="block text-sm font-medium text-ink" htmlFor="setup-phone">Mobile phone number</label>
          <input id="setup-phone" type="tel" autoComplete="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)}
            className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink" />
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy || !phoneInput.trim()} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Save number</button>
            <button type="button" onClick={backToMethods} className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink">Choose another method</button>
          </div>
        </form>
      );
    }
    return (
      <form onSubmit={checkPhone} className="space-y-4">
        <p className="text-sm text-ink-soft">We will text a code to {savedPhone} to check it is yours.</p>
        {!phoneSent && (
          <button type="button" disabled={busy} onClick={sendPhoneCode} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">
            Text me a code
          </button>
        )}
        {phoneSent && (
          <>
            <label className="block text-sm font-medium text-ink" htmlFor="phone-check-code">6-digit code from the text</label>
            <input id="phone-check-code" inputMode="numeric" autoComplete="one-time-code" value={phoneCode}
              onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink" />
            <div className="flex flex-wrap gap-3">
              <button type="submit" disabled={busy || phoneCode.length !== 6} className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50">Check my phone</button>
              <button type="button" disabled={busy} onClick={sendPhoneCode} className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium text-ink disabled:opacity-50">Send a new code</button>
            </div>
          </>
        )}
        {note && <p role="status" className="text-sm text-ink-soft">{note}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button type="button" onClick={backToMethods} className="text-sm font-medium text-action underline">Choose another method</button>
      </form>
    );
  }

  if (!setup) {
    return (
      <form onSubmit={begin} className="space-y-4">
        <p className="text-sm text-ink-soft">
          {method === "TOTP"
            ? "Confirm your current password. We will then show the key for your authenticator app."
            : "Confirm your current password. We will then send you a code to prove this method works."}
        </p>
        <label className="block text-sm font-medium text-ink" htmlFor="two-factor-password">
          Current password
        </label>
        <input
          id="two-factor-password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink"
        />
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
        >
          {busy ? "Starting…" : "Start setup"}
        </button>
      </form>
    );
  }

  const secret = secretFromUri(setup.totpURI);
  return (
    <form onSubmit={verify} className="space-y-4">
      {method === "TOTP" ? (
        <>
          <div className="rounded-card border border-line bg-subtle p-4">
            <p className="text-sm font-medium text-ink">Authenticator key</p>
            <p data-testid="two-factor-secret" className="mt-2 break-all font-mono text-sm text-ink">
              {secret}
            </p>
          </div>
          <p className="text-sm text-ink-soft">
            Add this key to your authenticator app under Robinson Appliance Rentals, then enter the 6-digit code it shows.
          </p>
        </>
      ) : (
        <p className="text-sm text-ink-soft">{note ?? "Enter the 6-digit code we sent you."}</p>
      )}
      <label className="block text-sm font-medium text-ink" htmlFor="two-factor-code">
        6-digit code
      </label>
      <input
        id="two-factor-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        required
        value={code}
        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
        className="w-full rounded-control border border-line-strong bg-surface px-3 py-2 text-ink"
      />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {method !== "TOTP" && method && (
        <p className="text-sm">
          <button type="button" disabled={busy} onClick={() => requestCode(method)} className="font-medium text-action underline disabled:opacity-50">Send a new code</button>
        </p>
      )}
      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="rounded-control bg-primary px-4 py-2 text-sm font-medium text-on-primary disabled:opacity-50"
      >
        {busy ? "Checking…" : "Verify and turn on"}
      </button>
    </form>
  );
}
