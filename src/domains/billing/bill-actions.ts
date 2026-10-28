// AR-3 (MONEY-AREA 3): which actions the bill record offers — pure rules, no database. The primary action
// comes only from payPathFor (MONEY-BILLS 4); a bank payment being confirmed suppresses every collect
// action (BILL-1: asking again could charge the customer twice).
import type { PayPath } from "./bill-status";

export type BillPrimary = "take-payment" | "take-card" | "record" | "print" | null;

export type BillRecordActions = {
  primary: BillPrimary;
  secondary: "record" | null;
  overflow: {
    sendText: boolean;
    useCredit: boolean;
    refund: boolean;
    giveUp: boolean;
    print: boolean;
    frozen: boolean;
  };
};

const FINAL_STATUSES = ["PAID", "VOID", "WRITTEN_OFF", "REFUNDED"];
const OPEN_STATUSES = ["OPEN", "PARTIALLY_PAID", "DELINQUENT", "FAILED"];

export function billActions(input: {
  status: string;
  taxBlocked: boolean;
  payPath: PayPath | null;
  beingConfirmed: boolean;
  refundableCents: number;
  hasCredits: boolean;
}): BillRecordActions {
  const isFinal = FINAL_STATUSES.includes(input.status);
  const isOpen = OPEN_STATUSES.includes(input.status);

  let primary: BillPrimary = null;
  let secondary: "record" | null = null;
  if (input.status === "DRAFT" && input.taxBlocked) {
    // No primary: the next-step card holds "Recalculate tax".
    primary = null;
  } else if (!input.beingConfirmed) {
    switch (input.payPath) {
      case "STRIPE_LINK":
        primary = "take-payment";
        secondary = "record";
        break;
      case "SHOP_CARD":
        primary = "take-card";
        secondary = "record";
        break;
      case "MANUAL_ONLY":
        primary = "record";
        break;
      default:
        primary = isFinal ? "print" : null;
    }
  }

  return {
    primary,
    secondary,
    overflow: {
      sendText: true,
      useCredit: input.hasCredits,
      refund: input.refundableCents > 0,
      giveUp: isOpen,
      print: true,
      frozen: isFinal,
    },
  };
}
