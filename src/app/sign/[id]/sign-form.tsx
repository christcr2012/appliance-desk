"use client";

import { useState, useTransition } from "react";
import { signAgreementAction } from "./actions";

export function SignForm({ signatureRecordId }: { signatureRecordId: string }) {
  const [isPending, startTransition] = useTransition();
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await signAgreementAction(signatureRecordId, {
        signerName,
        signerEmail,
        agreedToTerms,
      });
      if (result.status === "error") {
        setError(result.message);
      } else if (result.status === "success" && result.checkoutUrl) {
        // Straight to Stripe's own hosted checkout page — card/bank
        // details are entered there, never on this site (see
        // docs/BUSINESS-RULES.md's billing rules).
        window.location.href = result.checkoutUrl;
      } else {
        setSigned(true);
      }
    });
  }

  if (signed) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <p className="font-medium">Thanks — your agreement is signed.</p>
        <p className="mt-1">
          We&apos;ll be in touch about setting up payment and scheduling
          delivery. A copy of this confirmation was recorded with your
          name, email, and the time you signed.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-gray-200 bg-white p-5"
    >
      <div>
        <label htmlFor="signerName" className="block text-sm font-medium text-gray-700">
          Your full legal name
        </label>
        <input
          id="signerName"
          type="text"
          required
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="signerEmail" className="block text-sm font-medium text-gray-700">
          Your email
        </label>
        <input
          id="signerEmail"
          type="email"
          required
          value={signerEmail}
          onChange={(e) => setSignerEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={agreedToTerms}
          onChange={(e) => setAgreedToTerms(e.target.checked)}
        />
        I have read the terms above and agree to this rental agreement.
        Typing my name and submitting this form is my electronic signature.
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
      >
        {isPending ? "Submitting…" : "Sign agreement"}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
