"use client";

import { portalLabel } from "@/domains/language/portal-copy";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { signAgreementAction } from "./actions";
import { formatMoney } from "@/lib/money-ui";
import { signingText, type SigningKey } from "@/domains/language/signing-copy";
import type { CustomerLanguage } from "@/domains/language/copy";

export function SignForm({ signatureRecordId,deliveryOptions=[],offerVersion=0,initialLanguage="en",displayLanguage="en",translationCopyDigest }: {
  signatureRecordId: string;
  translationCopyDigest?: string;
  initialLanguage?: "en" | "es";
  displayLanguage?: CustomerLanguage;
  deliveryOptions?:Array<{id:string;date:string;window:"AM"|"PM"}>;
  offerVersion?:number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const tr = (word: Parameters<typeof portalLabel>[1]) => portalLabel(displayLanguage,word);
  const t = (key: SigningKey) => signingText(displayLanguage,key);
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
        interfaceLanguage: displayLanguage,
        translationCopyDigest,
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
        <p className="font-medium">{t("signed")}</p>
        {paymentNeedsReview ? (
          <p className="mt-1" role="status">
            {tr("We need to review your payment details before collecting any funds. No payment was confirmed here. We’ll contact you to arrange payment and delivery.")}
          </p>
        ) : pendingSigningAmountCents !== null ? (
          <div className="mt-2 space-y-1" role="status">
            <p className="font-semibold">
              {pendingSigningAmountCents > 0
                ? `${tr("Signing amount still to pay")}: ${formatMoney(pendingSigningAmountCents)}`
                : tr("No signing charge is due for this agreement.")}
            </p>
            <p>{tr("Signing does not confirm that payment was received. We’ll arrange a secure payment link or an owner-recorded payment if needed, then contact you about delivery. Rent begins billing on delivery; down payments will count toward that first invoice.")}</p>
          </div>
        ) : (
          <p className="mt-1">
            {t("signedNext")}
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
        <select value={languagePreference} onChange={(event) => {
          setLanguagePreference(event.target.value as "en" | "es");
          router.push(`/sign/${encodeURIComponent(signatureRecordId)}?language=${event.target.value === "es" ? "es" : "en"}`);
        }}
          className="mt-1 block w-full rounded border border-line bg-surface p-2">
          <option value="en">English</option><option value="es">Español</option>
        </select>
        <span className="mt-1 block text-xs text-ink-soft">
          {t("legalNote")}
        </span>
      </label>
      {deliveryOptions.length>0&&<fieldset className="space-y-3 rounded border border-line p-3">
        <legend className="font-semibold">{t("appointment")}</legend>
        <label className="block text-sm">{t("offered")}
          <select required value={selectedOption} onChange={e=>setSelectedOption(e.target.value)}
            className="block w-full rounded border border-line p-2">
            {deliveryOptions.map(o=><option key={o.id} value={o.id}>
              {o.date} · {o.window==="AM"?t("morning"):t("afternoon")}</option>)}
          </select>
        </label>
        <label className="block text-sm">{t("dryer")}
          <select value={dryerOutlet} onChange={e=>setDryerOutlet(e.target.value as typeof dryerOutlet)}
            className="block w-full rounded border border-line p-2">
            <option value="UNKNOWN">{t("unsure")}</option><option value="THREE_PRONG">{t("prong3")}</option>
            <option value="FOUR_PRONG">{t("prong4")}</option><option value="GAS">{t("gas")}</option>
          </select>
        </label>
        <label className="block text-sm">{t("washer")}
          <select value={washerHookups} onChange={e=>setWasherHookups(e.target.value as typeof washerHookups)}
            className="block w-full rounded border border-line p-2">
            <option value="UNKNOWN">{t("unsure")}</option><option value="YES">{t("yes")}</option>
            <option value="NO">{t("no")}</option>
          </select>
        </label>
        <label className="flex gap-2 text-sm"><input type="checkbox" checked={stairs}
          onChange={e=>setStairs(e.target.checked)}/> {t("stairs")}</label>
        <label className="block text-sm">{t("crew")}
          <textarea value={crewNotes} onChange={e=>setCrewNotes(e.target.value)}
            maxLength={1500} className="block w-full rounded border border-line p-2"/>
        </label>
        <p className="text-xs text-ink-soft">{t("visitOnly")}</p>
      </fieldset>}
      <div>
        <label htmlFor="signerName" className="block text-sm font-medium text-ink-soft">
          {t("personalLegal")}
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
          {t("personalEmail")}
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
        {t("consent")}
      </label>

      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-action px-4 py-2 text-sm font-medium text-on-action hover:bg-action disabled:opacity-50"
      >
        {isPending ? t("send") : t("sign")}
      </button>

      {error && (
        <p role="alert" className="text-sm text-red-700">
          {displayLanguage === "es" ? tr("Your request could not be completed. Try again or contact the business.") : error}
        </p>
      )}
    </form>
  );
}
