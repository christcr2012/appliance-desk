/** AR-7 (BOOKS-TAXES 2): the Taxes area has six sub-tabs; every tax screen belongs to exactly one
 * of them. This replaces the W-3 four-tab set (To file / Use tax / Rates & areas / Setup): Returns
 * and Exemptions are now tabs of their own, and use-tax settings sit under Use tax. */
export const TAXES_BASE = "/desk/sales-tax";

export const TAXES_TABS = [
  { key: "overview", label: "Overview", href: TAXES_BASE },
  { key: "returns", label: "Returns", href: `${TAXES_BASE}/returns` },
  { key: "areas", label: "Areas & rates", href: `${TAXES_BASE}/areas` },
  { key: "exemptions", label: "Exemptions", href: `${TAXES_BASE}/exemptions` },
  { key: "use-tax", label: "Use tax", href: `${TAXES_BASE}/use-tax` },
  { key: "setup", label: "Setup", href: `${TAXES_BASE}/setup` },
] as const;

export type TaxesTabKey = (typeof TAXES_TABS)[number]["key"];

/** Screens reached from the Setup tab (plain-words names; the address is what changed least). */
export const TAXES_SETUP_LINKS = [
  { href: `${TAXES_BASE}/setup`, label: "Filing accounts and tax setup", detail: "License number, how often you file, first period, your business address and where each tax is paid." },
  { href: `${TAXES_BASE}/exemptions`, label: "Customers who don't pay tax", detail: "Tax-exempt customers and their certificates." },
  { href: `${TAXES_BASE}/taxability`, label: "What gets taxed", detail: "Which charges are taxed and which are not." },
  { href: `${TAXES_BASE}/use-tax/settings`, label: "Use-tax threshold", detail: "The amount that decides how often you report use tax." },
  { href: `${TAXES_BASE}/audit-pack`, label: "Audit pack", detail: "Every appliance and part bought, with receipts and tax, for any date range." },
  { href: `${TAXES_BASE}/record-retention`, label: "How long to keep records", detail: "Starts at 7 years; owner-editable." },
  { href: `${TAXES_BASE}/rules`, label: "Tax and fee rules", detail: "Every tax and fee number, when it starts, where it came from, and its history." },
  { href: `${TAXES_BASE}/area`, label: "Delivery area", detail: "Every place you deliver to: whether its tax rules are decided and its city license is on file — an address cannot be quoted or scheduled until its places are ready." },
  { href: `${TAXES_BASE}/benefits`, label: "Tax benefits", detail: "Every write-off and benefit found in the books for the year — depreciation, start-up costs, mileage, home office, retirement, QBI — plus the capitalization policy to sign. Estimates: your CPA confirms." },
] as const;

const SETUP_PREFIXES = ["setup", "taxability", "audit-pack", "record-retention", "rules", "benefits"];
const RATES_PREFIXES = ["areas", "area", "delivery-fees"];

/** Which tab a Taxes address belongs to; null when the address is outside Taxes. */
export function activeTaxesTab(pathname: string): TaxesTabKey | null {
  if (pathname !== TAXES_BASE && !pathname.startsWith(`${TAXES_BASE}/`)) return null;
  const rest = pathname.slice(TAXES_BASE.length).split("/").filter(Boolean);
  const first = rest[0];
  if (!first) return "overview";
  if (first === "returns") return "returns";
  if (first === "exemptions") return "exemptions";
  if (first === "use-tax") return "use-tax";
  if (RATES_PREFIXES.includes(first)) return "areas";
  if (SETUP_PREFIXES.includes(first)) return "setup";
  return "overview";
}
