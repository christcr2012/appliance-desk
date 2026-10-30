import { portalLanguage } from "@/domains/language/portal";
import { portalLabel } from "@/domains/language/portal-copy";
import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { getPortalData } from "@/domains/portal";
import { getInvoiceDetail } from "@/domains/billing/invoice-detail";
import { InvoiceDocument } from "@/components/billing/invoice-document";
import { PrintDocumentButton } from "@/components/print-document-button";
import { RecordHeader } from "@/components/kit/record-header";
import { isPayNowEligible } from "@/domains/portal/pay-now";
import { invoiceStatusLabel, invoiceStatusTone } from "@/lib/status-labels";
import { PayErrorToast } from "./pay-error-toast";
import type { Tone } from "@/components/kit/types";

export const metadata = { title: "Bill" };

const FINAL_INVOICE_STATUSES = new Set(["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"]);

function kitTone(status: string): Tone {
  const tone = invoiceStatusTone(status);
  if (tone === "success") return "good";
  if (tone === "progress") return "info";
  if (tone === "stopped") return "danger";
  if (tone === "attention") return "attention";
  return "neutral";
}

/** A customer's own invoice, laid out as a real document (2026-09-29,
 * brand kit v2.0 phase 3 — see docs/DECISIONS.md), reached from a line
 * on /account/billing. getInvoiceDetail is called with this customer's
 * own id, so an invoice belonging to anyone else comes back null —
 * same customer-data-isolation guarantee as the rest of the portal
 * (see tests/customer-isolation.test.ts).
 *
 * PORTAL-1 section 5.4: a kit RecordHeader sits above the document
 * (title "Bill #n", status pill, back to Bills, frozen-record link in
 * the overflow for final bills). The document itself is a legal record
 * and keeps its own wording, "Invoice" included. Pay now stays a
 * native POST form under the header — the kit's form ActionSpec
 * invokes a server action and cannot express the existing pay route
 * POST (same call as the Home needs-you card). Print keeps the
 * existing PrintDocumentButton under the header: an ActionSpec has no
 * print kind. */
export default async function AccountInvoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ invoiceId: string }>;
  searchParams: Promise<{ payError?: string }>;
}) {
  const session = await requireSession();
  const language = await portalLanguage(session.user.id);
  const t = (word: Parameters<typeof portalLabel>[1]) => portalLabel(language, word);
  const { invoiceId } = await params;
  const { payError } = await searchParams;
  const customer = await getPortalData(session.user.id);

  if (!customer) {
    notFound();
  }

  const invoice = await getInvoiceDetail(invoiceId, { customerId: customer.id });

  if (!invoice) {
    notFound();
  }

  return (
    <div lang={language} className="max-w-3xl">
      <RecordHeader
        title={`${t("Bill")} #${invoice.invoiceNumber}`}
        back={{ href: "/account/billing", label: t("Bills") }}
        pills={[{ label: invoiceStatusLabel(invoice.status, language), tone: kitTone(invoice.status) }]}
        overflow={
          FINAL_INVOICE_STATUSES.has(invoice.status)
            ? [{ kind: "link", label: t("View frozen invoice record"), href: `/api/documents/invoice/${invoiceId}` }]
            : []
        }
      />
      <div className="flex justify-end print:hidden">
        <PrintDocumentButton label={t("Print / save as PDF")} />
      </div>

      {isPayNowEligible(invoice, new Date()) && (
        <div className="mt-4 rounded-card border border-line bg-subtle p-4 text-sm text-ink print:hidden">
          <p className="font-semibold">{invoice.isShopSale ? t("You can pay this sale securely by card on Stripe's payment page.") : t("This bill is past due. You can pay it securely on Stripe's payment page.")}</p>
          <form method="post" action={`/account/billing/invoice/${invoiceId}/pay`} className="mt-3">
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-control bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-dark"
            >
              {t("Pay now")}
            </button>
          </form>
        </div>
      )}
      {payError && (
        <PayErrorToast message={t("The payment page couldn't open. Try again, or call us.")} />
      )}

      {invoice.isLocalInvoice && !invoice.isShopSale && invoice.balanceCents > 0 && (
        <div className="mt-4 rounded-card border border-line bg-subtle p-4 text-sm text-ink print:hidden">
          <p className="font-semibold">{t("Pay as arranged with Robinson Appliance Rentals.")}</p>
          <p className="mt-1 text-ink-soft">
            {t("This invoice is recorded in Appliance Desk, but card payment for local invoices is not enabled yet.")}
          </p>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-soft print:hidden">{t("The frozen invoice record remains in its original English form.")}</p>
      <div className="mt-4 print:mt-0">
        <InvoiceDocument invoice={invoice} />
      </div>
    </div>
  );
}
