import { formatCents } from "@/domains/pricing/money";
import { formatBusinessDate } from "@/lib/business-date";

export const RENDERER_VERSION = 1;

export type BusinessIdentity = {
  name: string;
  phone: string;
  email: string;
  address: string;
};

export type SignedAgreementPayload = {
  agreementId: string;
  business: BusinessIdentity;
  customer: { name: string; email: string };
  serviceAddress: string;
  termMonths: number | null;
  lines: Array<{
    label: string;
    monthlyPriceCents: number;
    listPriceCents: number;
    prepayDiscountCentsPerMonth: number;
  }>;
  monthlyTotalCents: number;
  depositCents: number;
  damageWaiverCents: number;
  lateFeeGraceDays: number;
  lateFeeCents: number;
  lateFeePercent: number;
  taxRateMilliPercent: number;
  paidInFullInAdvance: boolean;
  freeMonthGranted: boolean;
  terms: {
    ending: { lines: string[]; termsText: string } | null;
    autoRenew: { noticeLine: string; termsText: string } | null;
  };
  signature: {
    signerName: string;
    signerEmail: string;
    ipAddress: string | null;
    signedAt: string;
  };
};

export type InvoicePayload = {
  invoiceId: string;
  invoiceNumber: number;
  status: string;
  business: BusinessIdentity;
  customer: { name: string; companyName: string | null; email: string };
  propertyAddress: string | null;
  createdAt: string;
  dueDate: string | null;
  billingPeriodStart: string | null;
  billingPeriodEnd: string | null;
  lineItems: Array<{ description: string; quantity: number; amountCents: number }>;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  lateFeeCents: number;
  amountDueCents: number;
  amountPaidCents: number;
  balanceCents: number;
};

export type StatementPayload = {
  month: string;
  business: BusinessIdentity;
  customer: { name: string; companyName: string | null };
  properties: Array<{
    addressLabel: string;
    invoices: Array<{
      invoiceNumber: number;
      status: string;
      dueDate: string | null;
      amountDueCents: number;
      amountPaidCents: number;
      balanceCents: number;
    }>;
    totalDueCents: number;
    totalPaidCents: number;
    totalBalanceCents: number;
  }>;
  totalDueCents: number;
  totalPaidCents: number;
  totalBalanceCents: number;
  reconciliation: {
    carriedForwardCents: number;
    invoicedCents: number;
    paymentsAppliedCents: number;
    creditsAppliedCents: number;
    writtenOffCents: number;
    closingBalanceCents: number;
    refundedCents: number;
    creditAvailableCents: number;
    balanced: boolean;
  };
};

function e(value: string | number | null | undefined): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function date(value: string | null): string {
  return value ? formatBusinessDate(new Date(value)) : "—";
}

function shell(title: string, business: BusinessIdentity, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
:root{color:#17251E;background:#F7F5EC;font-family:Manrope,Arial,sans-serif}*{box-sizing:border-box}body{margin:0;background:#F7F5EC;color:#17251E}.page{max-width:860px;margin:32px auto;background:#FFFFFF;border:1px solid #A5B8AB;border-radius:16px;overflow:hidden}.header{background:#123C2D;color:#FFFFFF;padding:28px 32px}.header h1{margin:0 0 6px;font-size:24px}.header p{margin:3px 0}.content{padding:28px 32px}.muted{color:#4E6658}.box{border:1px solid #A5B8AB;border-radius:8px;padding:16px;margin:16px 0}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{padding:9px 8px;border-bottom:1px solid #DCE7DF;text-align:left;vertical-align:top}th{font-size:12px;text-transform:uppercase;color:#4E6658}.right{text-align:right}.total{font-weight:800}.footer{padding:18px 32px;border-top:1px solid #DCE7DF;color:#4E6658;font-size:12px}@media(max-width:640px){.page{margin:0;border:0;border-radius:0}.grid{grid-template-columns:1fr}.header,.content,.footer{padding-left:18px;padding-right:18px}}@media print{body{background:#FFFFFF}.page{margin:0;max-width:none;border:0;border-radius:0}.header{background:#FFFFFF;color:#17251E;border-bottom:2px solid #123C2D}.no-print{display:none!important}}
</style></head><body><main class="page"><header class="header"><h1>${e(title)}</h1><p>${e(business.name)}</p><p>${e(business.address)}</p><p>${e(business.phone)} · ${e(business.email)}</p></header><section class="content">${body}</section><footer class="footer">${e(business.name)} · ${e(business.phone)} · ${e(business.email)}</footer></main></body></html>`;
}

export function renderSignedAgreement(payload: SignedAgreementPayload): string {
  const lineRows = payload.lines.map((line) => `<tr><td>${e(line.label)}</td><td class="right">${e(formatCents(line.monthlyPriceCents))}/month</td></tr>`).join("");
  const ending = payload.terms.ending
    ? `<div class="box"><h2>Ending this agreement early</h2><ul>${payload.terms.ending.lines.map((line) => `<li>${e(line)}</li>`).join("")}</ul><p>${e(payload.terms.ending.termsText).replaceAll("\n", "<br>")}</p></div>`
    : "";
  const renewal = payload.terms.autoRenew
    ? `<div class="box"><h2>Automatic renewal</h2><p>${e(payload.terms.autoRenew.noticeLine)}</p><p>${e(payload.terms.autoRenew.termsText).replaceAll("\n", "<br>")}</p></div>`
    : "";
  const fee = [
    payload.lateFeeCents > 0 ? formatCents(payload.lateFeeCents) : "",
    payload.lateFeePercent > 0 ? `${payload.lateFeePercent}%` : "",
  ].filter(Boolean).join(" or ") || "None";
  const body = `<div class="grid"><div><h2>Customer</h2><p>${e(payload.customer.name)}<br>${e(payload.customer.email)}</p></div><div><h2>Service address</h2><p>${e(payload.serviceAddress)}</p></div></div>
<div class="box"><p><strong>Term:</strong> ${payload.termMonths ? `${payload.termMonths} months` : "Month-to-month"}</p><table><thead><tr><th>Appliance</th><th class="right">Monthly price</th></tr></thead><tbody>${lineRows}</tbody></table><p class="right total">Monthly total: ${e(formatCents(payload.monthlyTotalCents))}</p>${payload.freeMonthGranted ? "<p><strong>Paid in full, in advance — first month free.</strong></p>" : ""}<p>Deposit: ${e(formatCents(payload.depositCents))}</p><p>Damage waiver: ${e(formatCents(payload.damageWaiverCents))}</p><p>Late fee after ${payload.lateFeeGraceDays} days: ${e(fee)}</p><p>Sales tax rate: ${e((payload.taxRateMilliPercent / 1000).toFixed(3).replace(/\.?0+$/, ""))}%</p></div>${ending}${renewal}
<div class="box"><h2>Signature evidence</h2><p>Signed by ${e(payload.signature.signerName)} (${e(payload.signature.signerEmail)}) on ${e(date(payload.signature.signedAt))}.</p><p class="muted">IP address: ${e(payload.signature.ipAddress ?? "Not recorded")}</p></div>`;
  return shell("Signed rental agreement", payload.business, body);
}

export function renderInvoice(payload: InvoicePayload): string {
  const rows = payload.lineItems.map((line) => `<tr><td>${e(line.description)}</td><td>${line.quantity}</td><td class="right">${e(formatCents(line.amountCents))}</td></tr>`).join("");
  const body = `<div class="grid"><div><h2>Billed to</h2><p>${e(payload.customer.name)}${payload.customer.companyName ? `<br>${e(payload.customer.companyName)}` : ""}<br>${e(payload.customer.email)}</p>${payload.propertyAddress ? `<p>${e(payload.propertyAddress)}</p>` : ""}</div><div><h2>Invoice #${payload.invoiceNumber}</h2><p>Status: ${e(payload.status)}</p><p>Issued: ${e(date(payload.createdAt))}</p><p>Due: ${e(date(payload.dueDate))}</p></div></div><table><thead><tr><th>Description</th><th>Qty</th><th class="right">Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="box"><p>Subtotal: ${e(formatCents(payload.subtotalCents))}</p><p>Discount: ${e(formatCents(payload.discountCents))}</p><p>Tax: ${e(formatCents(payload.taxCents))}</p><p>Late fee: ${e(formatCents(payload.lateFeeCents))}</p><p>Total due: ${e(formatCents(payload.amountDueCents))}</p><p>Paid: ${e(formatCents(payload.amountPaidCents))}</p><p class="total">Balance owed: ${e(formatCents(payload.balanceCents))}</p></div>`;
  return shell(`Invoice #${payload.invoiceNumber}`, payload.business, body);
}

export function renderStatement(payload: StatementPayload): string {
  const properties = payload.properties.map((property) => `<section class="box"><h2>${e(property.addressLabel)}</h2><table><thead><tr><th>Invoice</th><th>Status</th><th>Due</th><th class="right">Billed</th><th class="right">Paid</th><th class="right">Balance</th></tr></thead><tbody>${property.invoices.map((invoice) => `<tr><td>#${invoice.invoiceNumber}</td><td>${e(invoice.status)}</td><td>${e(date(invoice.dueDate))}</td><td class="right">${e(formatCents(invoice.amountDueCents))}</td><td class="right">${e(formatCents(invoice.amountPaidCents))}</td><td class="right">${e(formatCents(invoice.balanceCents))}</td></tr>`).join("")}</tbody></table><p class="right total">Property balance: ${e(formatCents(property.totalBalanceCents))}</p></section>`).join("");
  const body = `<div class="grid"><div><h2>Customer</h2><p>${e(payload.customer.name)}${payload.customer.companyName ? `<br>${e(payload.customer.companyName)}` : ""}</p></div><div><h2>Statement month</h2><p>${e(payload.month)}</p></div></div>${properties}<div class="box"><h2>Statement totals</h2><p>Total billed: ${e(formatCents(payload.totalDueCents))}</p><p>Total paid: ${e(formatCents(payload.totalPaidCents))}</p><p class="total">Balance: ${e(formatCents(payload.totalBalanceCents))}</p><p>Available account credit: ${e(formatCents(payload.reconciliation.creditAvailableCents))}</p>${payload.reconciliation.balanced ? "" : '<p><strong>This statement needs review because the ledger does not reconcile exactly.</strong></p>'}</div>`;
  return shell(`Statement — ${payload.month}`, payload.business, body);
}
