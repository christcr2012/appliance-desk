import type { InvoiceLineItemKind } from "@prisma/client";
import { businessDateKey, businessDateFromKey } from "@/lib/business-date";
import { lineKindAccountRole } from "./accounts";

export type PostingLine = { role: string; debitCents: number; creditCents: number };
export type PostingPlan = { entryDate: Date; memo: string; lines: PostingLine[] };
export class PostingEvidenceError extends Error {}

const whole = (value: number, label: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new PostingEvidenceError(label + " must be nonnegative integer cents.");
  return value;
};
const dateCheck = (date: Date) => {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new PostingEvidenceError("Missing valid source date.");
  return date;
};
const debit = (role: string, value: number): PostingLine => ({ role, debitCents: whole(value, role), creditCents: 0 });
const credit = (role: string, value: number): PostingLine => ({ role, debitCents: 0, creditCents: whole(value, role) });

export function balancedPlan(date: Date, memo: string, input: PostingLine[]): PostingPlan | null {
  dateCheck(date);
  if (!memo.trim() || memo.length > 500) throw new PostingEvidenceError("Missing or oversized journal explanation.");
  const lines = input.filter(line => {
    whole(line.debitCents, "Debit"); whole(line.creditCents, "Credit");
    if (line.debitCents && line.creditCents) throw new PostingEvidenceError("A journal line cannot be both debit and credit.");
    if (!line.role) throw new PostingEvidenceError("An account role is required.");
    return line.debitCents !== 0 || line.creditCents !== 0;
  });
  if (!lines.length) return null;
  const left = lines.reduce((n, line) => n + line.debitCents, 0);
  const right = lines.reduce((n, line) => n + line.creditCents, 0);
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || left !== right)
    throw new PostingEvidenceError("Journal would not balance; no entry created.");
  return { entryDate: postingBusinessDate(date), memo, lines };
}
export function reversePlan(plan: PostingPlan, date: Date, memo: string): PostingPlan {
  const result = balancedPlan(date, memo, plan.lines.map(line => ({
    role: line.role, debitCents: line.creditCents, creditCents: line.debitCents,
  })));
  if (!result) throw new PostingEvidenceError("Cannot reverse an empty journal.");
  return result;
}
export type InvoiceEvidence = {
  status: "DRAFT" | "OPEN" | "PAID" | "OVERDUE" | "VOID" | "OTHER";
  createdAt: Date; billingPeriodStart?: Date | null; voidedAt?: Date | null;
  amountDueCents: number; items: { kind: InvoiceLineItemKind; amountCents: number }[];
  taxes: { filingAccountId: string | null; taxCents: number }[];
};
/** One invoice, once: the sum of actual line-item amounts and tax breakdown must equal its face amount. */
export function invoiceRecognition(input: InvoiceEvidence): PostingPlan | null {
  if (input.status === "DRAFT") return null;
  if (!input.items.length && !input.taxes.length) throw new PostingEvidenceError("Invoice has no recognized lines.");
  const items = input.items.filter(row => row.kind !== "TAX" && row.kind !== "DEPOSIT");
  const itemSum = items.reduce((n, row) => n + row.amountCents, 0);
  const taxSum = input.taxes.reduce((n, row) => n + whole(row.taxCents, "Tax"), 0);
  // A refundable deposit billed on the invoice is not income. The customer owes it (it is in the amount due), and it
  // is parked in "unapplied receipts" until the deposit is funded, when `depositFunded` moves it to Deposits held.
  // That keeps every existing payment, deposit and refund entry unchanged and nets the parking account to zero.
  const depositSum = input.items.filter(row => row.kind === "DEPOSIT").reduce((n, row) => n + whole(row.amountCents, "Deposit"), 0);
  if (depositSum < 0) throw new PostingEvidenceError("A deposit line cannot be negative.");
  if (itemSum + taxSum + depositSum !== whole(input.amountDueCents, "Invoice total"))
    throw new PostingEvidenceError("Invoice lines and tax lines do not match amount due.");
  const lines: PostingLine[] = [debit("RECEIVABLES", input.amountDueCents)];
  if (depositSum > 0) lines.push(credit("UNAPPLIED_RECEIPTS", depositSum));
  for (const item of items) {
    if (!Number.isSafeInteger(item.amountCents)) throw new PostingEvidenceError("Invalid invoice line cents.");
    const role = lineKindAccountRole(item.kind, item.amountCents);
    if (role === "SKIP" || role === "TAX_LINES") continue;
    lines.push(item.amountCents >= 0 ? credit(role, item.amountCents) : debit(role, -item.amountCents));
  }
  for (const tax of input.taxes) lines.push(credit(tax.filingAccountId ? "SALES_TAX:" + tax.filingAccountId : "SALES_TAX_UNASSIGNED", tax.taxCents));
  return balancedPlan(input.billingPeriodStart ?? input.createdAt, "Invoice recognized", lines);
}
export function invoiceVoided(input: InvoiceEvidence): PostingPlan | null {
  if (input.status !== "VOID") return null;
  if (!input.voidedAt) throw new PostingEvidenceError("Voided invoice lacks evidence date.");
  const plan = invoiceRecognition(input);
  return plan && reversePlan(plan, input.voidedAt, "Invoice voided");
}

export type SimpleEvidence = { date: Date; amountCents: number };
export function receiptReceived(input: SimpleEvidence & { method: "STRIPE" | "MANUAL" }): PostingPlan | null {
  return balancedPlan(input.date, "Payment received", [
    debit(input.method === "STRIPE" ? "STRIPE_CLEARING" : "UNDEPOSITED", input.amountCents),
    credit("UNAPPLIED_RECEIPTS", input.amountCents),
  ]);
}
export function paymentApplied(input: SimpleEvidence & { receiptId: string | null; moneyArrived: boolean }): PostingPlan | null {
  if (!input.moneyArrived) return null;
  if (!input.receiptId) throw new PostingEvidenceError("Applied payment has no received funds evidence.");
  return balancedPlan(input.date, "Received money applied to invoice", [
    debit("UNAPPLIED_RECEIPTS", input.amountCents), credit("RECEIVABLES", input.amountCents),
  ]);
}
export function depositFunded(input: SimpleEvidence & { sourceReceiptId: string | null }): PostingPlan | null {
  if (!input.sourceReceiptId) return null;
  return balancedPlan(input.date, "Refundable customer deposit funded", [
    debit("UNAPPLIED_RECEIPTS", input.amountCents), credit("DEPOSITS_HELD", input.amountCents),
  ]);
}
export function creditIssued(input: SimpleEvidence & { source: "RECEIPT_OVERPAYMENT" | "GOODWILL" | "REFUND_TO_CREDIT" }): PostingPlan | null {
  const role = input.source === "RECEIPT_OVERPAYMENT" ? "UNAPPLIED_RECEIPTS" :
    input.source === "REFUND_TO_CREDIT" ? "REFUNDS" : "CREDITS_GIVEN";
  return balancedPlan(input.date, "Customer credit issued", [
    debit(role, input.amountCents), credit("CUSTOMER_CREDITS", input.amountCents),
  ]);
}
export function creditApplied(input: SimpleEvidence): PostingPlan | null {
  return balancedPlan(input.date, "Customer credit applied", [
    debit("CUSTOMER_CREDITS", input.amountCents), credit("RECEIVABLES", input.amountCents),
  ]);
}
export function refundIssued(input: SimpleEvidence & {
  stripeRefundId?: string | null;
  tax: { filingAccountId: string | null; taxCents: number }[];
}): PostingPlan | null {
  const tax = input.tax.reduce((n, item) => n + whole(item.taxCents, "Refund tax"), 0);
  if (tax > whole(input.amountCents, "Refund")) throw new PostingEvidenceError("Refund tax exceeds refund.");
  return balancedPlan(input.date, "Refund paid", [
    debit("REFUNDS", input.amountCents - tax),
    ...input.tax.map(item => debit(item.filingAccountId ? "SALES_TAX:" + item.filingAccountId : "SALES_TAX_UNASSIGNED", item.taxCents)),
    credit(input.stripeRefundId ? "STRIPE_CLEARING" : "BANK", input.amountCents),
  ]);
}
export function depositRefunded(input: SimpleEvidence & { stripeRefundId?: string | null }): PostingPlan | null {
  return balancedPlan(input.date, "Customer deposit returned", [
    debit("DEPOSITS_HELD", input.amountCents),
    credit(input.stripeRefundId ? "STRIPE_CLEARING" : "BANK", input.amountCents),
  ]);
}
export function depositRetained(input: SimpleEvidence): PostingPlan | null {
  return balancedPlan(input.date, "Customer deposit retained for damage", [
    debit("DEPOSITS_HELD", input.amountCents), credit("DAMAGE_RECOVERY_INCOME", input.amountCents),
  ]);
}
export function invoiceWrittenOff(input: SimpleEvidence & {
  taxRecoveryApproved: boolean;
  tax: { filingAccountId: string | null; taxCents: number }[];
}): PostingPlan | null {
  const tax = input.taxRecoveryApproved ? input.tax.reduce((n, item) => n + whole(item.taxCents, "Tax recovery"), 0) : 0;
  if (tax > whole(input.amountCents, "Write-off")) throw new PostingEvidenceError("Tax recovery exceeds open receivable.");
  return balancedPlan(input.date, "Uncollectible invoice balance", [
    debit("BAD_DEBT", input.amountCents - tax),
    ...(input.taxRecoveryApproved ? input.tax.map(item => debit(item.filingAccountId ? "SALES_TAX:" + item.filingAccountId : "SALES_TAX_UNASSIGNED", item.taxCents)) : []),
    credit("RECEIVABLES", input.amountCents),
  ]);
}
export type StripeBalanceEvidence = { type: string; reportingCategory: string; date: Date; amountCents: number; feeCents: number };
export function stripeBalancePlans(row: StripeBalanceEvidence): { eventKind: string; plan: PostingPlan }[] {
  const out: { eventKind: string; plan: PostingPlan }[] = [];
  const feeType = ["stripe_fee", "tax_fee", "application_fee"].includes(row.type);
  if (row.feeCents !== 0 && !feeType) {
    if (!Number.isSafeInteger(row.feeCents)) throw new PostingEvidenceError("Invalid Stripe fee cents.");
    const cost = Math.abs(row.feeCents);
    const plan = balancedPlan(row.date, "Card processing fee / reversal", row.feeCents > 0 ?
      [debit("CARD_FEES", cost), credit("STRIPE_CLEARING", cost)] :
      [debit("STRIPE_CLEARING", cost), credit("CARD_FEES", cost)]);
    if (plan) out.push({ eventKind: "STRIPE_FEE", plan });
  }
  if (feeType) {
    if (!Number.isSafeInteger(row.amountCents)) throw new PostingEvidenceError("Invalid Stripe service fee cents.");
    const cost = Math.abs(row.amountCents);
    const plan = balancedPlan(row.date, "Stripe service charge / reversal", row.amountCents < 0 ?
      [debit("STRIPE_SERVICE_FEES", cost), credit("STRIPE_CLEARING", cost)] :
      [debit("STRIPE_CLEARING", cost), credit("STRIPE_SERVICE_FEES", cost)]);
    if (plan) out.push({ eventKind: "STRIPE_SERVICE_FEE", plan });
  }
  if (row.type === "adjustment" && ["dispute","dispute_reversal"].includes(row.reportingCategory)) {
    const amount = Math.abs(row.amountCents);
    const reversed = row.reportingCategory === "dispute_reversal";
    const plan = balancedPlan(row.date, "Stripe dispute adjustment", reversed ?
      [debit("STRIPE_CLEARING", amount), credit("CHARGEBACKS",amount)] :
      [debit("CHARGEBACKS", amount), credit("STRIPE_CLEARING",amount)]);
    if (plan) out.push({ eventKind: "STRIPE_DISPUTE", plan });
  }
  if (row.type === "payout" || row.type === "payout_failure") {
    const amount = Math.abs(row.amountCents);
    const plan = balancedPlan(row.date, "Stripe payout / returned payout", row.type === "payout" ?
      [debit("BANK", amount), credit("STRIPE_CLEARING", amount)] :
      [debit("STRIPE_CLEARING", amount), credit("BANK", amount)]);
    if (plan) out.push({ eventKind: "STRIPE_PAYOUT", plan });
  }
  return out;
}
export function expensePosted(input: SimpleEvidence & { accountRole: string; paidFromRole: string; capitalize: boolean }): PostingPlan | null {
  return balancedPlan(input.date, "Expense posted", [
    debit(input.capitalize ? "RENTAL_EQUIPMENT" : input.accountRole, input.amountCents),
    credit(input.paidFromRole, input.amountCents),
  ]);
}
export function expenseVoided(original: PostingPlan, date: Date): PostingPlan {
  return reversePlan(original, date, "Expense posting reversed");
}
export function applianceContributed(input: SimpleEvidence & { booksStartDate: Date; capitalizedExpenseExists: boolean }): PostingPlan | null {
  if (input.capitalizedExpenseExists) return null;
  return balancedPlan(input.date < input.booksStartDate ? input.booksStartDate : input.date, "Rental appliance contributed", [
    debit("RENTAL_EQUIPMENT", input.amountCents), credit("OWNER_CONTRIBUTIONS", input.amountCents),
  ]);
}
export function depreciationAccrued(input: SimpleEvidence & { periodKey: string }): PostingPlan | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(input.periodKey))
    throw new PostingEvidenceError("Invalid depreciation period.");
  const [year, month] = input.periodKey.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (businessDateKey(input.date) !== input.periodKey + "-" + String(lastDay).padStart(2, "0"))
    throw new PostingEvidenceError("Depreciation must be posted on the last Colorado calendar day of its month.");
  return balancedPlan(input.date, "Appliance depreciation " + input.periodKey, [
    debit("DEPRECIATION", input.amountCents), credit("ACCUM_DEPRECIATION", input.amountCents),
  ]);
}
/** No speculative gain/loss: disposition's new K-6 contract must supply the approved mapping. */
export function assetDisposedBeforeK6(): never {
  throw new PostingEvidenceError("Asset retirement/disposition requires K-6 balanced asset mapping; no automatic loss.");
}
export function useTaxAccrued(input: SimpleEvidence & { filingAccountId: string }): PostingPlan | null {
  if (!input.filingAccountId) throw new PostingEvidenceError("Use tax has no filing-account evidence.");
  return balancedPlan(input.date, "Use tax on purchase", [
    debit("USE_TAX_EXPENSE", input.amountCents), credit("USE_TAX:" + input.filingAccountId, input.amountCents),
  ]);
}
export function taxFiled(input: {
  date: Date; filingAccountId: string; salesTaxCents: number; useTaxCents: number;
  paidCents: number; serviceFeeRetainedCents: number;
}): PostingPlan | null {
  if (!input.filingAccountId) throw new PostingEvidenceError("Filing account is required.");
  const sales = whole(input.salesTaxCents,"Sales tax"), use = whole(input.useTaxCents,"Use tax");
  const paid = whole(input.paidCents,"Tax paid"), fee = whole(input.serviceFeeRetainedCents,"Collection allowance");
  const difference = sales + use - paid - fee;
  return balancedPlan(input.date, "Tax filed and paid", [
    debit("SALES_TAX:" + input.filingAccountId,sales),
    debit("USE_TAX:" + input.filingAccountId,use),
    credit("BANK",paid), credit("TAX_SERVICE_FEE_INCOME",fee),
    ...(difference > 0 ? [credit("TAX_ADJUSTMENTS",difference)] : difference < 0 ? [debit("TAX_ADJUSTMENTS",-difference)] : []),
  ]);
}
export function openingBalance(input: { date: Date; stripeCents: number; bankCents: number; cardCents: number }): PostingPlan | null {
  const stripe = whole(input.stripeCents,"Stripe opening"), bank = whole(input.bankCents,"Bank opening"), card = whole(input.cardCents,"Card opening");
  const net = stripe + bank - card;
  return balancedPlan(input.date,"Initial books balances", [
    debit("STRIPE_CLEARING",stripe),debit("BANK",bank),credit("CARD",card),
    ...(net >= 0 ? [credit("OWNER_CONTRIBUTIONS",net)] : [debit("OWNER_CONTRIBUTIONS",-net)]),
  ]);
}
/** Business dates are Colorado-local even at DST transitions. */
export function postingBusinessDate(date: Date): Date {
  const result = businessDateFromKey(businessDateKey(date));
  if (!result) throw new PostingEvidenceError("Invalid posting date.");
  return result;
}
