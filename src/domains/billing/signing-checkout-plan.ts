import type { FrozenSigningEvidence } from "./signing-frozen-evidence";
import { verifySigningV2Extension } from "./signing-v2-lines";

/** A payment request is never a payment receipt or a balance credit. */
export type FrozenSigningCheckoutItem = {
  kind: "ADMIN_SETUP_FEE" | "ADMIN_SETUP_TAX" | "FIRST_MONTH_DOWN_PAYMENT" |
    "DELIVERY_FEE" | "INSTALLATION_FEE" | "REMOVAL_FEE" |
    "DAMAGE_WAIVER_FEE" | "REFUNDABLE_RESERVE" | "RETAIL_DELIVERY_FEE" |
    "SERVICE_TAX";
  amountCents: number;
  description: string;
};
export type FrozenSigningCheckoutPlan = {
  agreementId: string;
  orderFingerprint: string;
  evidenceVersion: 1 | 2;
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
      order.some(row => ![1,2].includes(row.schemaVersion) ||
        !/^[a-f0-9]{64}$/.test(row.orderFingerprint) ||
        ![row.setupFeeCents, row.setupTaxCents, row.downPaymentCents, row.allInCents].every(cents)) ||
      new Set(order.map(row => row.agreementId)).size !== order.length ||
      new Set(order.map(row => row.orderFingerprint)).size !== 1) {
    throw new Error("Complete reviewed frozen signing payment evidence is required.");
  }
  for (const row of order) {
    const sum = row.setupFeeCents + row.setupTaxCents + row.downPaymentCents;
    if (!cents(sum) || (row.schemaVersion === 1 && sum !== row.allInCents)) {
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
  if (line.schemaVersion === 2) {
    verifySigningV2Extension(line.v2Extension, line);
    const kinds = {
      DELIVERY: "DELIVERY_FEE", INSTALLATION: "INSTALLATION_FEE",
      REMOVAL: "REMOVAL_FEE", DAMAGE_WAIVER: "DAMAGE_WAIVER_FEE",
      COMMERCIAL_RESERVE: "REFUNDABLE_RESERVE",
      RETAIL_DELIVERY_FEE: "RETAIL_DELIVERY_FEE",
    } as const;
    for (const component of line.v2Extension.components) {
      if (component.category in kinds && component.disposition === "DUE_NOW" &&
          component.amountCents > 0) {
        const category = component.category as keyof typeof kinds;
        planned.push({ kind: kinds[category],
          amountCents: component.amountCents,
          description: category === "COMMERCIAL_RESERVE" ?
            "Refundable commercial reserve — not rent" :
            category.replaceAll("_", " ").toLowerCase() });
      }
    }
    for (const tax of line.v2Extension.taxLines) {
      if (!tax.componentId.endsWith(":ADMINISTRATIVE_SETUP") &&
          tax.taxCents > 0) {
        planned.push({ kind: "SERVICE_TAX", amountCents: tax.taxCents,
          description: "Reviewed service tax — " + tax.category });
      }
    }
  }
  const items = planned.filter(item => item.amountCents > 0);
  const amount = items.reduce((n, row) => n + row.amountCents, 0);
  if (!cents(amount) || amount !== line.allInCents) {
    throw new Error("Frozen signing payment lines do not reconcile.");
  }
  return {agreementId, orderFingerprint: line.orderFingerprint,
    evidenceVersion: line.schemaVersion, allInCents: line.allInCents, items};
}
