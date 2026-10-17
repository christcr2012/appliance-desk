import { formatMoney } from "@/lib/money-ui";

/** Colorado's own page for the Sales & Use Tax System (SUTS). Checked 2026-10-16 at https://tax.colorado.gov/SUTS-info. */
export const SUTS_LOGIN_URL = "https://suts.blt.govos.com/login";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-20" → "Oct 20" (plain business date, no time zone arithmetic). */
export function shortDateLabel(key: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) throw new Error("Invalid business date.");
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) throw new Error("Invalid business date.");
  return `${month} ${Number(match[3])}`;
}

export type FileAndPayInput = {
  kind: "SALES_RETURN" | "USE_TAX_RETURN" | "RETAIL_DELIVERY_FEE_RETURN";
  /** What the guided return says to pay today (on-time amount before the legal date, otherwise the late amount). */
  amountCents: number;
  /** Legal due date as a business date key. */
  legalDueOn: string;
  /** Today as a business date key. */
  todayKey: string;
  filed: boolean;
  /** The filing account's own website, when the owner stored one. */
  portalUrl: string | null;
  /** Use tax is shown by area (state and Greeley separate). */
  useTax: ReadonlyArray<{ name: string; useTaxCents: number }>;
};

export type FileAndPayLine = {
  headline: string;
  overdue: boolean;
  link: { href: string; label: string } | null;
  parts: { label: string; amount: string }[];
};

function httpsOnly(url: string | null): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** The one line every return page opens with (W-3, D-W4). Pure so each case is table-tested. */
export function fileAndPayLine(input: FileAndPayInput): FileAndPayLine {
  const amount = formatMoney(input.amountCents);
  const due = shortDateLabel(input.legalDueOn);
  const overdue = !input.filed && input.todayKey > input.legalDueOn;
  const parts = input.kind === "USE_TAX_RETURN"
    ? input.useTax.filter((row) => row.useTaxCents !== 0).map((row) => ({ label: `${row.name} use tax`, amount: formatMoney(row.useTaxCents) }))
    : [];
  if (input.filed) {
    return { headline: `Filed and paid. This return was due ${due}.`, overdue: false, link: null, parts: [] };
  }
  const stored = httpsOnly(input.portalUrl);
  const isSuts = input.kind !== "RETAIL_DELIVERY_FEE_RETURN";
  const where = isSuts ? "Colorado's sales tax website (SUTS)" : "the Colorado Department of Revenue website";
  const when = overdue ? `It was due ${due}; use the amount the website shows, which may include penalty and interest.` : `Due ${due}.`;
  const nothing = input.amountCents === 0;
  const headline = nothing
    ? `File a $0 return on ${where} by ${due}. A return with nothing owed still has to be filed.`
    : `File and pay ${amount} on ${where} by ${due}. ${overdue ? when : ""}`.trim();
  const href = stored ?? (isSuts ? SUTS_LOGIN_URL : null);
  return { headline, overdue, link: href ? { href, label: isSuts && !stored ? "Open SUTS" : "Open the filing website" } : null, parts };
}
