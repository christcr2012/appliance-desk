"use client";

import { useState, useTransition } from "react";
import { signAgreementAction } from "./actions";
import { formatMoney } from "@/lib/money-ui";

export function SignForm({ signatureRecordId,deliveryOptions=[],offerVersion=0,initialLanguage="en" }: {
  signatureRecordId: string;
  initialLanguage?: "en" | "es";
  deliveryOptions?:Array<{id:string;date:string;window:"AM"|"PM"}>;
  offerVersion?:number;
}) {
  const [isPending, startTransition] = useTransition();
  const [selectedOption,setSelectedOption]=useState(deliveryOptions[0]?.id??"");
  const [dryerOutlet,setDryerOutlet]=useState<"THREE_PRONG"|"FOUR_PRONG"|"GAS"|"UNKNOWN">("UNKNOWN");
  const [washerHookups,setWasherHookups]=useState<"YES"|"NO"|"UNKNOWN">("UNKNOWN");
  const [stairs,setStairs]=useState(false);
  const [crewNotes,setCrewNotes]=useState("");
  const [languagePreference, setLanguagePreference] = useState<"en" | "es">(initialLanguage);
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
        languagePreference,
        signerName,
        signerEmail,
        agreedToTerms,
        ...(deliveryOptions.length?{deliverySelection:{
          optionId:selectedOption,expectedOfferVersion:offerVersion,
          questions:{dryerOutlet,washerHookups,stairs,crewNotes},
        }}:{}),
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
      <label className="block text-sm">Preferred language / Idioma preferido
        <select value={languagePreference} onChange={(event) => setLanguagePreference(event.target.value as "en" | "es")}
          className="mt-1 block w-full rounded border border-line bg-surface p-2">
          <option value="en">English</option><option value="es">Español</option>
        </select>
        <span className="mt-1 block text-xs text-ink-soft">
          The English agreement controls until separately reviewed Spanish legal text is approved.
        </span>
      </label>
      {deliveryOptions.length>0&&<fieldset className="space-y-3 rounded border border-line p-3">
        <legend className="font-semibold">Requested delivery — subject to owner confirmation</legend>
        <label className="block text-sm">Choose an offered date/window
          <select required value={selectedOption} onChange={e=>setSelectedOption(e.target.value)}
            className="block w-full rounded border border-line p-2">
            {deliveryOptions.map(o=><option key={o.id} value={o.id}>
              {o.date} · {o.window==="AM"?"Morning":"Afternoon"}</option>)}
          </select>
        </label>
        <label className="block text-sm">Dryer connection
          <select value={dryerOutlet} onChange={e=>setDryerOutlet(e.target.value as typeof dryerOutlet)}
            className="block w-full rounded border border-line p-2">
            <option value="UNKNOWN">Not sure</option><option value="THREE_PRONG">3-prong</option>
            <option value="FOUR_PRONG">4-prong</option><option value="GAS">Gas</option>
          </select>
        </label>
        <label className="block text-sm">Washer hookups
          <select value={washerHookups} onChange={e=>setWasherHookups(e.target.value as typeof washerHookups)}
            className="block w-full rounded border border-line p-2">
            <option value="UNKNOWN">Not sure</option><option value="YES">Present</option>
            <option value="NO">Not present</option>
          </select>
        </label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={stairs}
          onChange={e=>setStairs(e.target.checked)}/> Stairs or tight access</label>
        <label className="block text-sm">Crew notes (optional)
          <textarea value={crewNotes} onChange={e=>setCrewNotes(e.target.value)}
            maxLength={1500} className="block w-full rounded border border-line p-2"/>
        </label>
        <p className="text-xs text-ink-soft">Signing only requests this visit; payment
          must be verified and an authorized person must confirm the actual booking.</p>
      </fieldset>}
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
