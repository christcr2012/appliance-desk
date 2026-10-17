/**
 * "Send payment link": the plain-English message that goes with a customer's secure Stripe payment page.
 * Pure functions only (no database, no Stripe), so every invoice state can be tested exactly.
 */
export const PAYMENT_LINK_REASONS = ["REMINDER", "FAILED", "PARTIAL", "PHONE"] as const;
export type PaymentLinkReason = (typeof PAYMENT_LINK_REASONS)[number];

export const REASON_LABEL: Record<PaymentLinkReason, string> = {
  REMINDER: "A reminder that the bill is due",
  FAILED: "The payment didn't go through",
  PARTIAL: "A balance is left after a partial payment",
  PHONE: "We talked on the phone",
};

export const TEMPLATE_PLACEHOLDERS = ["customer", "what", "amount", "dueDate", "overdue", "balance", "reason", "link"] as const;

const REASON_SENTENCE: Record<PaymentLinkReason, string> = {
  REMINDER: "this is a friendly reminder that this bill is due",
  FAILED: "your last payment didn't go through, so here is a secure way to pay it now",
  PARTIAL: "a balance is left after your last payment",
  PHONE: "as we discussed on the phone, here is a secure way to pay it",
};

export const DEFAULT_TEMPLATES: Record<PaymentLinkReason, string> = {
  REMINDER: "Hi {customer},\n\nThis is a friendly reminder from Robinson Appliance Rentals about {what}. Amount due: {amount}. {dueDate}{overdue}{balance}\n\nYou can pay securely online here (card or bank account): {link}\n\nThank you!",
  FAILED: "Hi {customer},\n\nYour last payment for {what} didn't go through. Amount due: {amount}. {dueDate}{overdue}{balance}\n\nYou can pay securely online here (card or bank account): {link}\n\nIf you have questions, just reply to this message.",
  PARTIAL: "Hi {customer},\n\nThank you for your payment. A balance is left on {what}: {amount}. {dueDate}{overdue}{balance}\n\nYou can pay the rest securely online here: {link}\n\nThank you!",
  PHONE: "Hi {customer},\n\nAs we discussed on the phone, here is the secure payment page for {what}. Amount due: {amount}. {dueDate}{overdue}{balance}\n\nPay securely here (card or bank account): {link}\n\nThank you!",
};

export type TemplateOverrides = Partial<Record<PaymentLinkReason, string>>;

/** Which reason fits the invoice. The owner can change it before sending. */
export function suggestPaymentLinkReason(invoice: { status: string; amountPaidCents: number }): PaymentLinkReason {
  if (invoice.status === "DELINQUENT") return "FAILED";
  if (invoice.status === "PARTIALLY_PAID" || invoice.amountPaidCents > 0) return "PARTIAL";
  return "REMINDER";
}

/** Returns a plain-English problem, or null when the wording can be saved. */
export function validateTemplate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length < 30 || trimmed.length > 1500) return "Write between 30 and 1500 characters.";
  if (!trimmed.includes("{link}")) return "Keep {link} in the message so the customer gets the payment page.";
  const unknown = [...trimmed.matchAll(/\{([^{}]*)\}/g)].map((m) => m[1]!).filter((k) => !(TEMPLATE_PLACEHOLDERS as readonly string[]).includes(k));
  if (unknown.length) return "These words in braces aren't recognised: " + [...new Set(unknown)].map((k) => "{" + k + "}").join(", ") + ".";
  if (/[{}]/.test(trimmed.replace(/\{(\w+)\}/g, ""))) return "Use braces only around the listed words, like {amount}.";
  return null;
}

export function templateFor(reason: PaymentLinkReason, overrides: TemplateOverrides | null | undefined): string {
  const custom = overrides?.[reason];
  return custom && validateTemplate(custom) === null ? custom : DEFAULT_TEMPLATES[reason];
}

const money = (cents: number) => "$" + (cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const longDate = (key: string) =>
  new Date(key + "T12:00:00Z").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export type PaymentLinkFacts = {
  customerName: string;
  /** Plain description of what the bill is for, from the invoice lines. */
  what: string;
  owedCents: number;
  /** Colorado business dates as YYYY-MM-DD. */
  dueOnKey: string | null;
  todayKey: string;
  lateFeeCents: number;
  /** Everything this customer owes across all open bills. */
  totalBalanceCents: number;
  link: string;
};

export function overdueDays(dueOnKey: string | null, todayKey: string): number {
  if (!dueOnKey) return 0;
  const days = Math.round((Date.parse(todayKey + "T00:00:00Z") - Date.parse(dueOnKey + "T00:00:00Z")) / 86_400_000);
  return days > 0 ? days : 0;
}

export function composePaymentLinkMessage(input: {
  reason: PaymentLinkReason;
  template: string;
  facts: PaymentLinkFacts;
  note?: string;
}): { subject: string; text: string } {
  const f = input.facts;
  if (!f.link.startsWith("https://")) throw new Error("A secure https payment page is required.");
  const late = overdueDays(f.dueOnKey, f.todayKey);
  const dueDate = f.dueOnKey ? (late > 0 ? "It was due " + longDate(f.dueOnKey) + "." : "It is due " + longDate(f.dueOnKey) + ".") : "";
  const overdue = late > 0
    ? " It is " + late + (late === 1 ? " day" : " days") + " overdue" + (f.lateFeeCents > 0 ? " and a late fee of " + money(f.lateFeeCents) + " has been added." : ".")
    : "";
  const balance = f.totalBalanceCents > f.owedCents
    ? " Your total balance across all open bills is " + money(f.totalBalanceCents) + "."
    : "";
  const values: Record<string, string> = {
    customer: f.customerName, what: f.what, amount: money(f.owedCents), dueDate, overdue, balance,
    reason: REASON_SENTENCE[input.reason], link: f.link,
  };
  let text = input.template.replace(/\{(\w+)\}/g, (_m, key: string) => values[key] ?? "").replace(/[ \t]+\n/g, "\n").replace(/ {2,}/g, " ").trim();
  const note = input.note?.trim();
  if (note) text = text + "\n\nNote from us: " + note.slice(0, 500);
  return { subject: "Payment page for your Robinson Appliance Rentals bill", text };
}
