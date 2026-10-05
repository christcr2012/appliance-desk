import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate } from "@/lib/business-date";

// ---------------------------------------------------------------------------
// Pure renderers for the saved copies of signed agreements, final invoices and
// monthly statements (Batch D, D6). No React, no clock, no settings read: the
// same payload always gives the same text, so the stored hash can be checked
// by rendering again. Dates travel in the payload as ISO strings.
// ---------------------------------------------------------------------------

export const RENDERER_VERSION = 1;

export type BusinessBlock = { name: string; phone: string; email: string; address: string };

export type SignedAgreementPayload = {
  agreementId: string;
  business: BusinessBlock;
  customerName: string;
  customerEmail: string;
  serviceAddress: string;
  termMonths: number | null;
  lines: { label: string; monthlyPriceCents: number; listPriceCents: number; prepayDiscountCentsPerMonth: number }[];
  monthlyTotalCents: number;
  freeMonthGranted: boolean;
  depositCents: number;
  damageWaiverCents: number;
  lateFeeGraceDays: number;
  lateFeeCents: number;
  lateFeePercent: number;
  taxRateMilliPercent: number;
  /** The exact terms text the customer saw on the signing page. */
  terms: {
    ending: { lines: string[]; termsText: string } | null;
    autoRenew: { noticeLine: string; termsText: string } | null;
  };
  signerName: string;
  signerEmail: string;
  signerIp: string | null;
  signedAtIso: string;
};

export type InvoicePayload = {
  invoiceId: string;
  invoiceNumber: number;
  status: string;
  business: BusinessBlock;
  customerName: string;
  customerCompany: string | null;
  customerEmail: string;
  propertyAddress: string | null;
  billingPeriodStartIso: string | null;
  billingPeriodEndIso: string | null;
  dueDateIso: string | null;
  createdAtIso: string;
  lineItems: { description: string; quantity: number; amountCents: number }[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  lateFeeCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  balanceCents: number;
  payments: { amountCents: number; method: string | null; status: string; createdAtIso: string }[];
};

export type StatementPayload = {
  customerId: string;
  /** Colorado calendar month, YYYY-MM. */
  month: string;
  business: BusinessBlock;
  customerName: string;
  customerCompany: string | null;
  invoices: {
    invoiceNumber: number;
    status: string;
    billingPeriodStartIso: string | null;
    amountDueCents: number;
    amountPaidCents: number;
    balanceCents: number;
  }[];
  totalDueCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const e = escapeHtml;
const date = (iso: string | null) => (iso ? e(formatBusinessDate(new Date(iso))) : "—");

const STYLE = `body{font-family:Georgia,'Times New Roman',serif;color:#1c2b24;background:#ffffff;margin:0;padding:32px;line-height:1.5}
main{max-width:720px;margin:0 auto}
h1{color:#123c2d;font-size:24px;margin:0 0 4px}
h2{color:#123c2d;font-size:16px;margin:24px 0 8px;border-bottom:1px solid #d7dfe5;padding-bottom:4px}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #d7dfe5}
th.num,td.num{text-align:right}
.muted{color:#4e6658;font-size:13px}
.total{font-weight:bold}
.terms{white-space:pre-line}
@media print{body{padding:0}main{max-width:none}}`;

function page(title: string, business: BusinessBlock, body: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${e(title)}</title><style>${STYLE}</style></head>
<body><main>
<header><p class="muted">${e(business.name)}${business.address ? ` · ${e(business.address)}` : ""}${business.phone ? ` · ${e(business.phone)}` : ""}${business.email ? ` · ${e(business.email)}` : ""}</p></header>
${body}
</main></body></html>`;
}

function money(cents: number): string {
  return e(formatCents(cents));
}

export function renderSignedAgreement(p: SignedAgreementPayload): string {
  const rows = p.lines
    .map(
      (l) =>
        `<tr><td>${e(l.label)}${
          l.prepayDiscountCentsPerMonth > 0
            ? `<div class="muted">List price ${money(l.listPriceCents)}/month, less a ${money(l.prepayDiscountCentsPerMonth)}/month term discount</div>`
            : ""
        }</td><td class="num">${money(l.monthlyPriceCents)}/month</td></tr>`,
    )
    .join("");
  const lateFee =
    p.lateFeeCents > 0 || p.lateFeePercent > 0
      ? `<p>Late fee after ${p.lateFeeGraceDays} days: ${[p.lateFeeCents > 0 ? money(p.lateFeeCents) : "", p.lateFeePercent > 0 ? `${p.lateFeePercent}%` : ""].filter(Boolean).join(" or ")}</p>`
      : "";
  const ending = p.terms.ending
    ? `<h2>Ending this agreement early</h2><ul>${p.terms.ending.lines.map((l) => `<li>${e(l)}</li>`).join("")}</ul><p class="terms">${e(p.terms.ending.termsText)}</p>`
    : "";
  const renew = p.terms.autoRenew
    ? `<h2>Automatic renewal</h2><p>${e(p.terms.autoRenew.noticeLine)}</p><p class="terms">${e(p.terms.autoRenew.termsText)}</p>`
    : "";
  const body = `<h1>Signed rental agreement</h1>
<p class="muted">Prepared for ${e(p.customerName)} (${e(p.customerEmail)})</p>
<h2>Agreement</h2>
<p>Service address: ${e(p.serviceAddress)}</p>
<p>Term: ${p.termMonths ? `${p.termMonths} months` : "Month-to-month"}</p>
<table><thead><tr><th>Appliance</th><th class="num">Price</th></tr></thead><tbody>${rows}</tbody></table>
<p class="total">Total: ${money(p.monthlyTotalCents)}/month</p>
${p.freeMonthGranted ? "<p>Paid in full, in advance — the first month is free.</p>" : ""}
${p.depositCents > 0 ? `<p>Deposit: ${money(p.depositCents)}</p>` : ""}
${p.damageWaiverCents > 0 ? `<p>Damage waiver: ${money(p.damageWaiverCents)} once at signing</p>` : ""}
${lateFee}
${p.taxRateMilliPercent > 0 ? `<p>Sales tax rate: ${e((p.taxRateMilliPercent / 1000).toFixed(3))}%</p>` : ""}
${ending}${renew}
<h2>Signature</h2>
<p>Signed by ${e(p.signerName)} (${e(p.signerEmail)}) on ${date(p.signedAtIso)}${p.signerIp ? ` from IP address ${e(p.signerIp)}` : ""}.</p>
<p class="muted">Agreement reference ${e(p.agreementId)}</p>`;
  return page("Signed rental agreement", p.business, body);
}

export function renderInvoice(p: InvoicePayload): string {
  const rows = p.lineItems
    .map(
      (l) =>
        `<tr><td>${e(l.description)}</td><td class="num">${l.quantity}</td><td class="num">${money(l.amountCents)}</td></tr>`,
    )
    .join("");
  const pay = p.payments
    .map(
      (x) =>
        `<tr><td>${date(x.createdAtIso)}</td><td>${e(x.method ?? "—")}</td><td>${e(x.status)}</td><td class="num">${money(x.amountCents)}</td></tr>`,
    )
    .join("");
  const body = `<h1>Invoice #${p.invoiceNumber}</h1>
<p class="muted">Status: ${e(p.status)} · Issued ${date(p.createdAtIso)} · Due ${date(p.dueDateIso)}</p>
<h2>Bill to</h2>
<p>${e(p.customerCompany ?? p.customerName)}<br>${e(p.customerEmail)}${p.propertyAddress ? `<br>Property: ${e(p.propertyAddress)}` : ""}</p>
${p.billingPeriodStartIso ? `<p>Billing period: ${date(p.billingPeriodStartIso)}${p.billingPeriodEndIso ? ` to ${date(p.billingPeriodEndIso)}` : ""}</p>` : ""}
<table><thead><tr><th>Description</th><th class="num">Qty</th><th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>
<table><tbody>
<tr><td>Subtotal</td><td class="num">${money(p.subtotalCents)}</td></tr>
${p.discountCents > 0 ? `<tr><td>Discount</td><td class="num">−${money(p.discountCents)}</td></tr>` : ""}
<tr><td>Tax</td><td class="num">${money(p.taxCents)}</td></tr>
${p.lateFeeCents > 0 ? `<tr><td>Late fee</td><td class="num">${money(p.lateFeeCents)}</td></tr>` : ""}
<tr class="total"><td>Amount due</td><td class="num">${money(p.amountDueCents)}</td></tr>
<tr><td>Paid</td><td class="num">${money(p.amountPaidCents)}</td></tr>
<tr class="total"><td>Balance</td><td class="num">${money(p.balanceCents)}</td></tr>
</tbody></table>
${p.payments.length ? `<h2>Payments</h2><table><thead><tr><th>Date</th><th>Method</th><th>Status</th><th class="num">Amount</th></tr></thead><tbody>${pay}</tbody></table>` : ""}`;
  return page(`Invoice #${p.invoiceNumber}`, p.business, body);
}

export function renderStatement(p: StatementPayload): string {
  const rows = p.invoices
    .map(
      (i) =>
        `<tr><td>#${i.invoiceNumber}</td><td>${e(i.status)}</td><td>${date(i.billingPeriodStartIso)}</td><td class="num">${money(i.amountDueCents)}</td><td class="num">${money(i.amountPaidCents)}</td><td class="num">${money(i.balanceCents)}</td></tr>`,
    )
    .join("");
  const body = `<h1>Statement for ${e(p.month)}</h1>
<p class="muted">${e(p.customerCompany ?? p.customerName)}</p>
${
  p.invoices.length === 0
    ? "<p>No invoices were billed this month.</p>"
    : `<table><thead><tr><th>Invoice</th><th>Status</th><th>Period start</th><th class="num">Due</th><th class="num">Paid</th><th class="num">Balance</th></tr></thead><tbody>${rows}</tbody></table>`
}
<p class="total">Billed ${money(p.totalDueCents)} · Paid ${money(p.totalPaidCents)} · Balance ${money(p.totalBalanceCents)}</p>`;
  return page(`Statement ${p.month}`, p.business, body);
}
