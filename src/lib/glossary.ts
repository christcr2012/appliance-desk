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
  "use-tax": { title: "Use tax", description: "Use tax may be owed on purchases without enough seller sales tax. Purchase evidence and filings stay separately traceable." },
  "set-price": { title: "Set price", description: "A washer and dryer set groups two individually tracked machines. It is not one inventory appliance." },
  "prepaid-discount": { title: "Prepaid discount", description: "An approved reduction for paying a longer rental term in advance. The signed agreement controls each customer's amount." },
  "custody": { title: "Custody", description: "Who has an appliance and when it moved. Each machine keeps its own delivery, pickup, and inspection history." },
  "admin-setup-fee": { title: "Administrative setup fee", description: "The recommended $45 charge applies once per new delivery location, not per machine. It does not automatically apply to a repair, swap or renewal. The owner may adjust a quote with a written reason." },
  "large-order-down-payment": { title: "Large-order down payment", description: "For orders of at least five machines, or business and property-manager clients, the proposed signing payment includes the first month of each rental. That amount must later be credited to the first invoice exactly once." },
  "setup-fee-tax": { title: "Setup fee tax treatment", description: "Whether Colorado taxes the separately stated administrative setup fee needs tax-adviser confirmation. Undecided treatment blocks collection in the proposed signing-charge plan." },
} as const;
export type GlossaryKey = keyof typeof GLOSSARY;
