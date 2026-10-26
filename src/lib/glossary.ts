/** Plain-language explanations shared by owner screens. */
export const GLOSSARY = {
  "retail-delivery-fee": {
    title: "Retail delivery fee",
    description: "Colorado may require a fee on qualifying retail deliveries. Your CPA should confirm when it applies before any live collection.",
  },
  "rdf-threshold": {
    title: "Delivery fee threshold",
    description: "This dollar threshold affects the current fee rule. Changing it does not rewrite older invoices or turn on live charges.",
  },
  "rdf-rate": {
    title: "Recorded delivery fee rate",
    description: "The amount recorded for an effective date. Older rates are retained so historical calculations stay accurate.",
  },
  "use-tax-threshold": {
    title: "Use tax reporting threshold",
    description: "This amount helps determine filing frequency from use tax owed during the year, not purchase prices. Confirm filing rules with a tax adviser.",
  },
  "rate-change": { title: "Maximum automatic rate change", description: "This limits which reviewed official rate updates may apply automatically. Larger changes need owner review." },
  "record-retention": {
    title: "How long to keep purchase records",
    description: "Receipts and tax records for a purchase are kept this many years. The starting value is 7 years, a cautious general-purpose choice; ask your CPA what applies to you. A receipt that a filed return relies on can never be removed, whatever this says.",
  },
  "rental-ending-reminder": { title: "Rental ending reminder", description: "How many days before a fixed-term rental ends you get a To do to renew it, move it to month-to-month, or schedule a pickup. The starting value is 30 days. The reminder never sends or charges anything." },
  "payment-link-wording": { title: "Payment link wording", description: "The message that travels with a customer's secure Stripe payment page. The recommended wording explains what the bill is for, the amount, the due date and why you are sending it. You always preview the exact message before it is sent." },
  "suts": { title: "SUTS", description: "Colorado's Sales & Use Tax System, the state website where you file sales and use tax returns and pay what you owe. Appliance Desk shows the numbers to type in; it never files or pays for you." },
  "use-tax": { title: "Use tax", description: "Use tax may be owed on purchases without enough seller sales tax. Purchase evidence and filings stay separately traceable." },
  "set-price": { title: "Set price", description: "A washer and dryer set groups two individually tracked machines. It is not one inventory appliance." },
  "prepaid-discount": { title: "Prepaid discount", description: "An approved reduction for paying a longer rental term in advance. The signed agreement controls each customer's amount." },
  "custody": { title: "Custody", description: "Who has an appliance and when it moved. Each machine keeps its own delivery, pickup, and inspection history." },
  // AR-0b reference screens (Today, Money › Bills, Customer record).
  "week-money-in": { title: "Money in", description: "Payments received since Monday, after refunds." },
  "out-renting": { title: "Out renting", description: "Appliances with a customer now, out of all the appliances you can rent." },
  "overdue-bills": { title: "Overdue", description: "Bills past their due date that are not fully paid." },
  "bill-failed": { title: "Payment failed", description: "The card or bank refused the payment. Take payment again or send a reminder." },
  "bill-given-up": { title: "Given up", description: "You decided not to collect this bill. It still counts in your records." },
  "owes-now": { title: "Owes now", description: "Bills that are sent and not fully paid." },
  "pays-on-time": { title: "Pays on time", description: "Bills paid by the end of their due day, out of the last few bills." },
  "admin-setup-fee": { title: "Administrative setup fee", description: "The recommended $45 charge applies once per new delivery location, not per machine. It does not automatically apply to a repair, swap or renewal. The owner may adjust a quote with a written reason." },
  "large-order-down-payment": { title: "Large-order down payment", description: "For orders of at least five machines, or business and property-manager clients, the proposed signing payment includes the first month of each rental. That amount must later be credited to the first invoice exactly once." },
  "setup-fee-tax": { title: "Setup fee tax treatment", description: "Whether Colorado taxes the separately stated administrative setup fee needs tax-adviser confirmation. Undecided treatment blocks collection in the proposed signing-charge plan." },
} as const;
export type GlossaryKey = keyof typeof GLOSSARY;
