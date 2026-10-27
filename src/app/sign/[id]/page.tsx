import { isPickupAddress } from "@/domains/delivery/pickup-guard";
import { authPageLanguage } from "@/domains/language/auth-page";
import { portalLabel, portalStatement } from "@/domains/language/portal-copy";
import { agreementLanguage, agreementLegalTexts } from "@/domains/language/legal";
import { CustomerLegalText } from "@/components/customer-legal-text";
import Link from "next/link";
import { getSignatureRecordForSigning } from "@/domains/agreements";
import { describeSnapshotTerms } from "@/domains/agreements/terms-snapshot";
import { formatCents } from "@/domains/pricing";
import { SignForm } from "./sign-form";
import { readOfferedSlots } from "@/domains/orders/delivery";
import { ReviewedSigningOrder } from "@/components/billing/reviewed-signing-order";
import { parseCustomerLanguage } from "@/domains/language/copy";
import { signingText } from "@/domains/language/signing-copy";

export const metadata = {
  title: "Sign your rental agreement",
  robots: { index: false, follow: false },
};

export default async function SignPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ language?: string }>;
}) {
  const { id } = await params;
  const signature = await getSignatureRecordForSigning(id);

  if (!signature) {
    const language=await authPageLanguage((await searchParams)?.language);
    return (
      <main lang={language} className="mx-auto max-w-lg px-6 py-16 text-center">
        <h1 className="text-xl font-semibold">{portalLabel(language,"This link isn't available")}</h1>
        <p className="mt-3 text-ink-soft">
          {portalLabel(language,"This agreement may already be signed, or the link may no longer be valid. If you think this is a mistake, contact us directly.")}
        </p>
      </main>
    );
  }

  const { agreement } = signature;
  const requested = (await searchParams)?.language;
  const preference = requested === "en" || requested === "es" ? requested : parseCustomerLanguage(agreement.customer.preferredLanguage);
  const {language,translations,digest} = await agreementLanguage(preference, agreementLegalTexts(agreement.termsSnapshot));
  const translationCopyDigest = language === "es" ? digest ?? undefined : undefined;
  const t = (key: Parameters<typeof signingText>[1]) => signingText(language, key);
  const lockedTerms = agreement.termMonths
    ? describeSnapshotTerms(agreement.termsSnapshot,language)
    : { ending: null, autoRenew: null };
  const monthlyTotal = agreement.lines.reduce((sum, l) => sum + l.monthlyPriceCents, 0);

  return (
    <main lang={language} className="mx-auto max-w-lg px-6 py-16">
      <nav aria-label="Language / Idioma" className="mb-4 flex gap-4 text-sm">
        <Link href={`/sign/${encodeURIComponent(id)}?language=en`} hrefLang="en">English</Link>
        <Link href={`/sign/${encodeURIComponent(id)}?language=es`} hrefLang="es">Español</Link>
      </nav>
      <h1 className="text-xl font-semibold">{t("title")}</h1>
      <p className="mt-2 text-sm text-ink-soft">{t("legal")}</p>
      <p className="mt-2 text-sm text-ink-soft">
        {t("prepared")} {agreement.customer.user.name ?? agreement.customer.user.email}
      </p>

      <div className="mt-6 space-y-3 rounded-lg border border-line bg-surface p-5 text-sm">
        <p>
          <span className="font-medium">{t("service")}:</span>{" "}
          {agreement.serviceAddress.line1}, {agreement.serviceAddress.city},{" "}
          {agreement.serviceAddress.state} {agreement.serviceAddress.zip}
        </p>
        <p>
          <span className="font-medium">{t("term")}:</span>{" "}
          {agreement.termMonths ? `${agreement.termMonths} ${t("months")}` : t("monthToMonth")}
        </p>
        <div>
          <span className="font-medium">{t("appliances")}:</span>
          <ul className="mt-1 list-inside list-disc">
            {agreement.lines.map((l) => (
              <li key={l.id}>
                {l.label} — {formatCents(l.monthlyPriceCents)} {t("monthly")}
                {l.prepayDiscountCentsPerMonth > 0 && (
                  <span className="text-ink-soft">
                    {" "}
                    ({t("listPrice")} {formatCents(l.listPriceCents)} {t("monthly")}, {t("less")}{" "}
                    {formatCents(l.prepayDiscountCentsPerMonth)} {t("monthly")} {t("termDiscount")})
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
        <p className="font-medium">{t("total")}: {formatCents(monthlyTotal)}{language === "en" ? "/month" : ` ${t("monthly")}`}</p>
        {agreement.freeMonthGranted && (
          <p className="font-medium text-green-700">
            {t("firstFree")}
          </p>
        )}
        {signature.frozenSigningLine && (
          <section aria-label={t("charges")} className="space-y-1 border-t border-line pt-3">
            <h2 className="font-medium">{t("charges")}</h2>
            <p>{t("setup")}: {formatCents(signature.frozenSigningLine.setupFeeCents)}</p>
            <p>{t("setupTax")}: {formatCents(signature.frozenSigningLine.setupTaxCents)}</p>
            <p>{t("downPayment")}: {formatCents(signature.frozenSigningLine.downPaymentCents)}</p>
            <p className="font-semibold">{t("dueSigning")}: {formatCents(signature.frozenSigningLine.allInCents)}</p>
            <p className="text-ink-soft">{t("noReceiptDetails")}</p>
          </section>
        )}
        {agreement.depositCents > 0 && (
          <p>{t("deposit")}: {formatCents(agreement.depositCents)}</p>
        )}
        {agreement.damageWaiverCents > 0 && (
          <p>{t("waiver")}: {formatCents(agreement.damageWaiverCents)} {t("once")}</p>
        )}
        {(agreement.lateFeeCents > 0 || agreement.lateFeePercent > 0) && (
          <p>
            {portalStatement(language,"lateFee",{days:Math.max(10,agreement.lateFeeGraceDays)})}{" "}
            {agreement.lateFeeCents > 0 && formatCents(agreement.lateFeeCents)}
            {agreement.lateFeeCents > 0 && agreement.lateFeePercent > 0 && (portalLabel(language," or "))}
            {agreement.lateFeePercent > 0 && `${agreement.lateFeePercent}%`}
            {". "}{portalStatement(language,"lateFeeRest")}
          </p>
        )}
      </div>

      {signature.frozenOrder && <ReviewedSigningOrder order={signature.frozenOrder} language={language} />}

      {lockedTerms.ending && (
        <section
          aria-labelledby="ending-terms-heading"
          className="mt-4 space-y-2 rounded-lg border border-line bg-surface p-5 text-sm"
        >
          <h2 id="ending-terms-heading" className="font-medium">
            {portalLabel(language,"Ending this agreement early")}
          </h2>
          <ul className="list-inside list-disc">
            {lockedTerms.ending.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <CustomerLegalText language={language} english={lockedTerms.ending.termsText} spanish={translations.find(row=>row.english === lockedTerms.ending!.termsText)?.spanish} />
        </section>
      )}

      {lockedTerms.autoRenew && (
        <section
          aria-labelledby="renew-terms-heading"
          className="mt-4 space-y-2 rounded-lg border border-line bg-surface p-5 text-sm"
        >
          <h2 id="renew-terms-heading" className="font-medium">
            {portalLabel(language,"Automatic renewal")}
          </h2>
          <p>{lockedTerms.autoRenew.noticeLine}</p>
          <CustomerLegalText language={language} english={lockedTerms.autoRenew.termsText} spanish={translations.find(row=>row.english === lockedTerms.autoRenew!.termsText)?.spanish} />
        </section>
      )}

      <div className="mt-6">
        <SignForm translationCopyDigest={translationCopyDigest} displayLanguage={language} initialLanguage={preference} signatureRecordId={signature.id}
          deliveryOptions={isPickupAddress(agreement.deliveryZoneSnapshot, null, null) ? [] : readOfferedSlots(agreement.deliveryOffer)}
          offerVersion={agreement.deliveryOfferVersion}/>
      </div>
    </main>
  );
}
