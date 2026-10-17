import { portalLabel } from "@/domains/language/portal-copy";
import { formatCents } from "@/domains/pricing";
import type { EstimatePreparedQuote } from "@/domains/estimates/preapproval-quote";
import { moneyLabel, type MoneyLabel } from "@/domains/language/reviewed-money";
import type { CustomerLanguage } from "@/domains/language/copy";

export function ReviewedPreapprovalQuote({ quote, owner = false, language = "en" }: {
  quote: EstimatePreparedQuote;
  owner?: boolean; language?: CustomerLanguage;
}) {
  const tr = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language,word);
  const t = (key: MoneyLabel) => moneyLabel(language,key);
  if (quote.status !== "READY" || !quote.totals) {
    return (
      <section aria-label="Estimate price readiness" className="mt-5 rounded border border-amber-400 p-4 text-sm">
        <h2 className="font-semibold">{t("needsReview")}</h2>
        <p className="mt-1 text-ink-soft">
          {t("unreadyBody")}
        </p>
        {owner && (
          <ul className="mt-2 list-inside list-disc text-ink-soft">
            {quote.reasons.map(reason => <li key={reason}>{reason}</li>)}
          </ul>
        )}
      </section>
    );
  }
  return (
    <section aria-labelledby="reviewed-quote-title" className="mt-5 space-y-3 rounded-lg border border-line bg-surface p-4 text-sm">
      <h2 id="reviewed-quote-title" className="text-base font-semibold">
        {t("reviewedTitle")}
      </h2>
      <p className="text-ink-soft">
        {t("reviewedBody")}
      </p>
      <div className="overflow-x-auto" role="region" aria-label="Scrollable per-address reviewed money" tabIndex={0}>
        <table className="w-full text-left">
          <caption className="mb-2 text-left text-ink-soft">
            {t("caption")}
          </caption>
          <thead><tr className="border-b border-line">
            <th className="py-2 pr-3">{t("property")}</th>
            <th className="py-2 pr-3">{t("rent")}</th>
            <th className="py-2 pr-3">{t("tax")}</th>
            <th className="py-2 pr-3">{t("setupTogether")}</th>
            <th className="py-2">{t("deposit")}</th>
          </tr></thead>
          <tbody>
            {quote.locations.map(row => (
              <tr key={row.agreementId} className="border-b border-line">
                <td className="py-2 pr-3">{row.serviceAddress}</td>
                <td className="py-2 pr-3">{formatCents(row.monthlyRentCents)}</td>
                <td className="py-2 pr-3">{formatCents(row.monthlyRentTaxCents)}</td>
                <td className="py-2 pr-3">{formatCents(row.setupFeeCents + row.setupTaxCents)}</td>
                <td className="py-2">
                  {formatCents(row.advanceCents)}
                  {(row.additionalItems ?? []).map((item, index) => (
                    <p key={item.label + index} className="text-xs text-ink-soft">
                      {item.label}: {item.status === "BUSINESS_PAID" ?
                        tr("Paid by business") : formatCents(item.amountCents)}
                    </p>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="grid gap-2 sm:grid-cols-2">
        <div><dt className="text-ink-soft">{t("rent")}</dt>
          <dd className="font-medium">{formatCents(quote.totals.monthlyRentCents)}</dd></div>
        <div><dt className="text-ink-soft">{t("calculatedTax")}</dt>
          <dd className="font-medium">{formatCents(quote.totals.monthlyRentTaxCents)}</dd></div>
        <div><dt className="text-ink-soft">{t("oneTimeSetup")}</dt>
          <dd className="font-medium">{formatCents(quote.totals.setupFeeCents)}</dd></div>
        <div><dt className="text-ink-soft">{t("oneTimeTax")}</dt>
          <dd className="font-medium">{formatCents(quote.totals.setupTaxCents)}</dd></div>
        <div><dt className="text-ink-soft">{tr("First-month advance (credited to first invoice)")}</dt>
          <dd className="font-medium">{formatCents(quote.totals.advanceCents)}</dd></div>
        <div><dt className="text-ink-soft">{tr("Due at signing, not yet paid")}</dt>
          <dd className="font-semibold">{formatCents(quote.totals.dueAtSigningCents)}</dd></div>
      </dl>
      <p className="text-xs text-ink-soft">{tr("Signing funds are independently verified. The first rental invoice applies any valid advance only once. No deposit checkout is automatically initiated. The complete applicable terms must also receive any required legal and owner approval.")}</p>
      {owner && <p className="font-mono text-xs break-all">Quote fingerprint: {quote.quoteFingerprint}</p>}
    </section>
  );
}
