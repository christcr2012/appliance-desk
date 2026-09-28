"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // Deliberately the same message whether or not the email exists in our
  // system — Better Auth's own request-password-reset endpoint already
  // behaves this way server-side (so this can't be used to check which
  // emails have an account), and the form here just matches that.
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: requestError } = await authClient.requestPasswordReset({
      email,
      redirectTo: "/reset-password",
    });

    setSubmitting(false);
    if (requestError) {
      setError(
        requestError.message ?? "Something went wrong. Please try again.",
      );
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">
        If that email has an account, a reset link is on its way — check your
        inbox (and spam folder) in a few minutes.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
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
          aria-describedby={error ? "forgot-password-error" : undefined}
          className="rounded border border-gray-300 px-3 py-2"
        />
      </div>

      {error && (
        <p id="forgot-password-error" role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="mt-2 rounded bg-primary px-4 py-2 font-medium text-on-primary hover:bg-primary-dark disabled:opacity-60"
      >
        {submitting ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
