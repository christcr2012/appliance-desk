import type { NotificationKind } from "@prisma/client";
import type { GLOSSARY } from "@/lib/glossary";

/**
 * AR-13: the plain-words face of each notification kind — the preferences row label and the
 * "Created when" sentence its InfoTip shows (NOTIFICATIONS.md sections 6 and 7, exact words).
 */
export const KIND_META: Record<
  NotificationKind,
  { label: string; createdWhen: string; glossary: keyof typeof GLOSSARY }
> = {
  LEAD_NEW: {
    label: "New lead",
    createdWhen: "Created when a new lead comes in — from the website form, or added by hand by someone else on the team.",
    glossary: "notification-lead-new",
  },
  QUOTE_VIEWED: {
    label: "Quote opened",
    createdWhen: "Created when a customer opens a quote that was sent to them, the first time they open it.",
    glossary: "notification-quote-viewed",
  },
  SIGNATURE_DONE: {
    label: "Rental signed",
    createdWhen: "Created when a customer signs their rental agreement.",
    glossary: "notification-signature-done",
  },
  PAYMENT_FAILED: {
    label: "Payment failed",
    createdWhen: "Created when a customer's payment for a bill does not go through.",
    glossary: "notification-payment-failed",
  },
  APPROVAL_REQUESTED: {
    label: "Approval needed",
    createdWhen: "Created when someone on the team asks the owner to approve something over their limit.",
    glossary: "notification-approval-requested",
  },
};
