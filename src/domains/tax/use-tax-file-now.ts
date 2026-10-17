import { formatMoney } from "@/lib/money-ui";
import type { FilingPacket } from "@/domains/tax/filing-packet";

/** Colorado's own page for Revenue Online (consumer use tax is filed and paid there). Checked 2026-10-17 on the DR 0252 instructions. */
export const REVENUE_ONLINE_URL = "https://www.colorado.gov/RevenueOnline";

export type FileNowItem = {
  /** Plain label, matching the line on the state's DR 0252 form. */
  label: string;
  /** The value to type or paste; plain text, never HTML. */
  value: string;
  /** One short sentence when the value needs explaining. */
  hint?: string;
};
export type FileNowStep = { title: string; items: FileNowItem[] };

function monthYear(key: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(key);
  if (!match) throw new Error("Invalid business date.");
  return `${match[2]}/${match[1].slice(2)}`;
}
function ratePercent(purchaseCents: number, useTaxCents: number): string {
  if (purchaseCents <= 0) return "0%";
  const percent = (useTaxCents / purchaseCents) * 100;
  return `${Number(percent.toFixed(3))}%`;
}

/**
 * The consumer use tax return (DR 0252) as an ordered list of what to type, in the order of the state's form
 * lines. Pure: it only reorganizes the numbers already in the filing packet, adds nothing the packet does not know,
 * and never submits or pays anything (D-WA2). Purchases that already carried Colorado tax are not in the packet,
 * so line 2a is zero and the amount to pay is the packet's own total.
 */
export function buildUseTaxFileNow(packet: FilingPacket): FileNowStep[] {
  if (packet.account.kind !== "USE_TAX_RETURN") {
    throw new Error("The File now steps are for consumer use tax returns only.");
  }
  const totalPurchases = packet.useTax.reduce((sum, row) => sum + row.purchaseCents, 0);
  const steps: FileNowStep[] = [
    {
      title: "Who and when",
      items: [
        { label: "Account name", value: packet.account.name },
        ...(packet.account.accountNumber ? [{ label: "Account number", value: packet.account.accountNumber }] : []),
        { label: "Period covered (MM/YY-MM/YY)", value: `${monthYear(packet.periodStart)}-${monthYear(packet.periodEnd)}` },
      ],
    },
    {
      title: "Line 1: what you bought",
      items: [
        { label: "Line 1, taxable amount (total purchases)", value: formatMoney(totalPurchases),
          hint: "Add up the purchases on this return. The detailed list of purchases is in the audit pack for this period." },
        { label: "Line 2a, purchases that already had Colorado tax", value: formatMoney(0),
          hint: "Zero: purchases where the seller already charged Colorado tax are not on this return." },
        { label: "Line 2b, taxable amount (line 1 minus 2a)", value: formatMoney(totalPurchases) },
      ],
    },
    {
      title: "Lines 3 to 5: the tax for each area",
      items: packet.useTax.flatMap((row) => [
        { label: `${row.name}: tax rate (line 3)`, value: ratePercent(row.purchaseCents, row.useTaxCents),
          hint: row.filingCode ? `Area code ${row.filingCode}.` : undefined },
        { label: `${row.name}: net tax due (line 5)`, value: formatMoney(row.useTaxCents),
          hint: "Line 4, the credit for tax already paid to another state, is zero unless you paid tax elsewhere on the same item." },
      ]),
    },
    {
      title: "Lines 6 to 9: penalty, interest and the total",
      items: [
        { label: "Lines 6 and 7, penalty and interest", value: formatMoney(0),
          hint: "Zero when filed on time. If it is late, use the amounts the website shows." },
        { label: "Line 9, total amount owed", value: formatMoney(packet.totals.remitCents),
          hint: "This is what to pay. The website will show its own total; if it differs, use the website's and say why when you record it." },
      ],
    },
  ];
  if (packet.useTax.length === 0) {
    steps[2] = { title: "Lines 3 to 5: the tax for each area", items: [
      { label: "Nothing owed this period", value: formatMoney(0),
        hint: "Colorado still wants a return when nothing is owed. Enter zero and file it." },
    ] };
  }
  return steps;
}
