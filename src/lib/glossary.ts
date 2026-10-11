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
  "use-tax": { title: "Use tax", description: "Use tax may be owed on purchases without enough seller sales tax. Purchase evidence and filings stay separately traceable." },
  "set-price": { title: "Set price", description: "A washer and dryer set groups two individually tracked machines. It is not one inventory appliance." },
  "prepaid-discount": { title: "Prepaid discount", description: "An approved reduction for paying a longer rental term in advance. The signed agreement controls each customer's amount." },
  "custody": { title: "Custody", description: "Who has an appliance and when it moved. Each machine keeps its own delivery, pickup, and inspection history." },
} as const;
export type GlossaryKey = keyof typeof GLOSSARY;
