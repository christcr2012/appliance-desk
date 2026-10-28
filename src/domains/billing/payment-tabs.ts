// AR-3 (MONEY-AREA 2): the Payments list's status rules — pure, no database. Which stored payment statuses
// belong to each tab, the pill each status shows, and the everyday word for each payment method.
import type { Prisma } from "@prisma/client";
import type { Tone } from "@/components/kit/types";
import type { GlossaryKey } from "@/lib/glossary";
import {
  FAILED_PAYMENT_STATUSES,
  HELD_CONFLICT_STATUS,
  HELD_PAYMENT_STATUS,
  SUCCESSFUL_PAYMENT_STATUSES,
} from "./payment-status";

export type PaymentTab = "received" | "failed" | "held" | "deposits" | "waiting";
export const PAYMENT_TABS: readonly PaymentTab[] = ["received", "failed", "held", "deposits", "waiting"];

export function isPaymentTab(value: string | null | undefined): value is PaymentTab {
  return (PAYMENT_TABS as readonly string[]).includes(value ?? "");
}

/**
 * The stored statuses a tab lists. Deposits and Waiting render their own existing components, so they have
 * no payment-status rule (null). Decided held payments (held_to_credit, held_refunded) are in NO tab: they
 * appear only on the bill's timeline.
 */
export function paymentTabStatuses(tab: PaymentTab): readonly string[] | null {
  switch (tab) {
    case "received":
      return SUCCESSFUL_PAYMENT_STATUSES;
    case "failed":
      return FAILED_PAYMENT_STATUSES;
    case "held":
      return [HELD_PAYMENT_STATUS, HELD_CONFLICT_STATUS];
    case "deposits":
    case "waiting":
      return null;
  }
}

export function paymentTabWhere(tab: PaymentTab): Prisma.PaymentWhereInput | null {
  const statuses = paymentTabStatuses(tab);
  return statuses === null ? null : { status: { in: [...statuses] } };
}

export type PaymentPill = { label: string; tone: Tone; info?: GlossaryKey };

export function paymentPill(status: string): PaymentPill {
  if ((SUCCESSFUL_PAYMENT_STATUSES as readonly string[]).includes(status)) return { label: "Received", tone: "good" };
  if ((FAILED_PAYMENT_STATUSES as readonly string[]).includes(status)) return { label: "Failed", tone: "attention" };
  if (status === HELD_PAYMENT_STATUS) return { label: "Needs a decision", tone: "attention", info: "held-payment" };
  if (status === HELD_CONFLICT_STATUS) return { label: "Check this", tone: "danger", info: "held-conflict" };
  return { label: "Recorded", tone: "neutral" };
}

export const PAYMENT_METHODS = ["card", "ach", "check", "cash", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const METHOD_WORDS: Record<PaymentMethod, string> = {
  card: "Card",
  ach: "Bank (ACH)",
  check: "Check",
  cash: "Cash",
  bank_transfer: "Bank transfer",
  other: "Other",
};

export function paymentMethodWord(method: string | null | undefined): string {
  return (METHOD_WORDS as Record<string, string>)[method ?? ""] ?? "Other";
}
