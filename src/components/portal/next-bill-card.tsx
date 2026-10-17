import { Card } from "@/components/ui";
import { portalLabel } from "@/domains/language/portal-copy";
import type { CustomerLanguage } from "@/domains/language/copy";
import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate } from "@/lib/business-date";
import type { NextBill } from "@/domains/portal/next-bill";

/** W-20: the rent on the next bill, per current rental. Tax and credits are on the bill itself. */
export function NextBillCard({ bills, locale }: { bills: NextBill[]; locale: CustomerLanguage }) {
  if (bills.length === 0) return null;
  const t = (text: Parameters<typeof portalLabel>[1]) => portalLabel(locale, text);
  return (
    <Card title={t("Your next bill")} description={t("Your next bill is for rent only. Tax and any credits are shown on the bill itself.")}>
      <ul className="space-y-3">
        {bills.map((bill) => (
          <li key={bill.agreementId} className="text-sm">
            <p className="text-2xl font-semibold text-ink">{formatCents(bill.rentCents)}</p>
            <p className="text-ink-soft">
              {bill.addressLabel} · {t("due")} {formatBusinessDate(bill.date, locale)}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}
