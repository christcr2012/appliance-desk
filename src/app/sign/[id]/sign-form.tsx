"use client";

import { useState, useTransition } from "react";
import { signAgreementAction } from "./actions";
import { formatMoney } from "@/lib/money-ui";

export function SignForm({ signatureRecordId }: { signatureRecordId: string }) {
  const [isPending, startTransition] = useTransition();
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signed, setSigned] = useState(false);
  const [pendingSigningAmountCents, setPendingSigningAmountCents] = useState<number | null>(null);
  const [paymentNeedsReview, setPaymentNeedsReview] = useState(false);

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
        if (result.status === "success") {
          setPendingSigningAmountCents(result.pendingSigningAmountCents ?? null);
          setPaymentNeedsReview(result.paymentNeedsReview ?? false);
        }
        setSigned(true);
      }
    });
  }

  if (signed) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 p-5 text-sm text-green-900">
        <p className="font-medium">Thanks — your agreement is signed.</p>
        {paymentNeedsReview ? (
          <p className="mt-1" role="status">
            We need to review your payment details before collecting any funds.
            No payment was confirmed here. We&apos;ll contact you to arrange payment and delivery.
          </p>
        ) : pendingSigningAmountCents !== null ? (
          <div className="mt-2 space-y-1" role="status">
            <p className="font-semibold">
              {pendingSigningAmountCents > 0
                ? `Signing amount still to pay: ${formatMoney(pendingSigningAmountCents)}`
                : "No signing charge is due for this agreement."}
            </p>
            <p>Signing does not confirm that payment was received. We&apos;ll arrange a
              secure payment link or an owner-recorded payment if needed, then contact
              you about delivery. Rent begins billing on delivery; down payments
              will count toward that first invoice.</p>
          </div>
        ) : (
          <p className="mt-1">
            We&apos;ll be in touch about setting up payment and scheduling
            delivery. No payment was confirmed by signing. Your signature
            confirmation has been recorded.
          </p>
        )}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-4 rounded-lg border border-line bg-surface p-5"
    >
      <div>
        <label htmlFor="signerName" className="block text-sm font-medium text-ink-soft">
          Your full legal name
        </label>
        <input
          id="signerName"
          type="text"
          required
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label htmlFor="signerEmail" className="block text-sm font-medium text-ink-soft">
          Your email
        </label>
        <input
          id="signerEmail"
          type="email"
          required
          value={signerEmail}
          onChange={(e) => setSignerEmail(e.target.value)}
          className="mt-1 w-full rounded-md border border-line-strong px-3 py-2 text-sm"
        />
      </div>
      <label className="flex items-start gap-2 text-sm text-ink-soft">
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
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
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
