"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "@/lib/auth-client";
import { getPostLoginDestination } from "./actions";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const nextPath = searchParams.get("next");
    window.sessionStorage.setItem("appliance-desk-post-2fa-next", nextPath ?? "");
    const { data, error: signInError } = await signIn.email({ email, password });

    setSubmitting(false);
    if (signInError) {
      window.sessionStorage.removeItem("appliance-desk-post-2fa-next");
      setError(
        signInError.message ?? "That email and password don't match. Please try again.",
      );
      return;
    }

    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      return;
    }

    window.sessionStorage.removeItem("appliance-desk-post-2fa-next");
    const destination = await getPostLoginDestination(nextPath);
    router.push(destination);
    router.refresh();
  }

  const signedOutForTimeout = searchParams.get("reason") === "timeout";
  const deactivated = searchParams.get("deactivated") === "1";

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {signedOutForTimeout && (
        <p
          role="status"
          className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          You were signed out after a while with no activity, to help keep
          your account safe. Log back in to continue.
        </p>
      )}
      {deactivated && (
        <p
          role="alert"
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          This account no longer has access. If you think that&apos;s a
          mistake, ask the business owner to check your account.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className="rounded border border-line-strong px-3 py-2"
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "login-error" : undefined}
          className="rounded border border-line-strong px-3 py-2"
        />
        <Link
          href="/forgot-password"
          className="self-end text-sm text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </div>

      {error && (
        <p id="login-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-primary px-4 py-2 font-medium text-on-primary hover:bg-primary-dark disabled:opacity-60"
      >
        {submitting ? "Logging in…" : "Log in"}
      </button>
    </form>
  );
}
