"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

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

export function TwoFactorSetupForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<SetupData | null>(null);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    const result = await authClient.twoFactor.verifyTotp({
      code: code.trim(),
      trustDevice: false,
    });
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
        <ul className="grid gap-2 rounded-card border border-line bg-subtle p-4 font-mono text-sm sm:grid-cols-2">
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

  if (!setup) {
    return (
      <form onSubmit={begin} className="space-y-4">
        <p className="text-sm text-ink-soft">
          Confirm your current password. We will then show the key for your authenticator app.
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
      <div className="rounded-card border border-line bg-subtle p-4">
        <p className="text-sm font-medium text-ink">Authenticator key</p>
        <p data-testid="two-factor-secret" className="mt-2 break-all font-mono text-sm text-ink">
          {secret}
        </p>
      </div>
      <p className="text-sm text-ink-soft">
        Add this key to your authenticator app under Robinson Appliance Rentals, then enter the 6-digit code it shows.
      </p>
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
