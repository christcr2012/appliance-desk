import type { FrozenSigningEvidence } from "./signing-frozen-evidence";

/** A payment request is never a payment receipt or a balance credit. */
export type FrozenSigningCheckoutItem = {
  kind: "ADMIN_SETUP_FEE" | "ADMIN_SETUP_TAX" | "FIRST_MONTH_DOWN_PAYMENT";
  amountCents: number;
  description: string;
};
export type FrozenSigningCheckoutPlan = {
  agreementId: string;
  orderFingerprint: string;
  evidenceVersion: 1;
  allInCents: number;
  items: FrozenSigningCheckoutItem[];
};
const cents = (n: number) => Number.isSafeInteger(n) && n >= 0;

/**
 * Derive the provider-independent one-time plan from independently validated
 * getFrozenSigningOrderInTx evidence. Reconcile every cent again at this
 * boundary; no mutable business settings, browser amounts or rental lines.
 * The caller still needs signed-offer ownership, tax and provider replay
 * checks before using this plan to request money.
 */
export function buildFrozenSigningCheckoutPlan(
  order: readonly FrozenSigningEvidence[], agreementId: string,
): FrozenSigningCheckoutPlan {
  if (!agreementId || order.length < 1 || order.length > 500 ||
      order.some(row => row.schemaVersion !== 1 ||
        !/^[a-f0-9]{64}$/.test(row.orderFingerprint) ||
        ![row.setupFeeCents, row.setupTaxCents, row.downPaymentCents, row.allInCents].every(cents)) ||
      new Set(order.map(row => row.agreementId)).size !== order.length ||
      new Set(order.map(row => row.orderFingerprint)).size !== 1) {
    throw new Error("Complete reviewed frozen signing payment evidence is required.");
  }
  for (const row of order) {
    const sum = row.setupFeeCents + row.setupTaxCents + row.downPaymentCents;
    if (!cents(sum) || sum !== row.allInCents) {
      throw new Error("Frozen signing payment cents do not reconcile.");
    }
  }
  const line = order.find(row => row.agreementId === agreementId);
  if (!line) throw new Error("Agreement is outside the frozen signing order.");
  const planned: FrozenSigningCheckoutItem[] = [
    {kind: "ADMIN_SETUP_FEE", amountCents: line.setupFeeCents, description: "Administrative setup fee"},
    {kind: "ADMIN_SETUP_TAX", amountCents: line.setupTaxCents, description: "Sales tax on administrative setup fee"},
    {kind: "FIRST_MONTH_DOWN_PAYMENT", amountCents: line.downPaymentCents, description: "First-month rent down payment (credited on first bill)"},
  ];
  const items = planned.filter(item => item.amountCents > 0);
  if (items.reduce((n, row) => n + row.amountCents, 0) !== line.allInCents) {
    throw new Error("Frozen signing payment lines do not reconcile.");
  }
  return {agreementId, orderFingerprint: line.orderFingerprint,
    evidenceVersion: 1, allInCents: line.allInCents, items};
}
