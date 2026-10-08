import type { FilingPacket } from "@/domains/tax/filing-packet";

function dollars(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Worksheet amounts must be integer cents.");
  return (cents / 100).toFixed(2);
}

export type UseTaxWorksheet = {
  heading: string;
  rows: { label: string; value: string }[];
  warning: string;
};

/**
 * Owner-only server-side worksheet data. This is not an official DR 0252 PDF,
 * and must never be represented as a completed Colorado tax return.
 */
export function buildUseTaxWorksheet(packet: FilingPacket): UseTaxWorksheet {
  if (packet.account.kind !== "USE_TAX_RETURN") {
    throw new Error("A consumer use-tax worksheet requires a use-tax filing account.");
  }
  const rows: UseTaxWorksheet["rows"] = [
    { label: "Account", value: packet.account.name },
    { label: "Filing period", value: packet.periodStart + " through " + packet.periodEnd },
    { label: "Due date", value: packet.legalDueOn },
  ];
  for (const [index, item] of packet.useTax.entries()) {
    rows.push(
      { label: `Purchase area ${index + 1}`, value: item.name },
      { label: `Taxable purchases ${index + 1} ($)`, value: dollars(item.purchaseCents) },
      { label: `Use tax due ${index + 1} ($)`, value: dollars(item.useTaxCents) },
    );
  }
  rows.push({ label: "Total calculated tax ($)", value: dollars(packet.totals.taxCents) });
  return {
    heading: "Colorado consumer use-tax worksheet",
    rows,
    warning: "Worksheet to copy into Revenue Online or the official form. Not a completed official return; verify figures and current filing instructions before submitting.",
  };
}
