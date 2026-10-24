// Names and help text for admin permissions. No database access, so screens can import it.
export const CAPABILITIES = {
  RECORD_MANUAL_PAYMENT: { label: "Record a cash, check or bank payment", help: "Mark an invoice paid by hand." },
  WRITE_OFF: { label: "Write off an unpaid invoice", help: "Give up on money a customer owes." },
  RESOLVE_HELD_PAYMENT: { label: "Settle a held payment", help: "Decide what happens to a payment that was held for review." },
  REFUND_DEPOSIT: { label: "Refund or keep a deposit", help: "Decide how much of a deposit goes back." },
  ISSUE_REFUND: { label: "Refund a payment", help: "Send money back to a customer." },
  EDIT_SETTINGS: { label: "Change business settings", help: "Fees, policies, prices and sets, profile and service area." },
  POST_EXPENSES: { label: "Post or void an expense", help: "Make an expense count in the books, or cancel one." },
} as const;
export type Capability = keyof typeof CAPABILITIES;
export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as Capability[];
