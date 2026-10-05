import type { EarlyReturnChoice } from "./early-return";

/**
 * The early-return screen keeps its choices in the page address and in form fields as plain text. This turns that text
 * into a typed choice (and back), so the page, the confirm button and the tests all agree. Pure: no database.
 */

export type EarlyReturnFields = {
  billing?: string;
  unusedDays?: string;
  fee?: string; // AGREED_TERMS | NONE | CUSTOM
  feeDollars?: string;
  feeReason?: string;
};

function dollarsToCents(raw: string): number | null {
  const value = raw.trim().replace(/^\$/, "");
  const match = /^(\d{1,6})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

export function choiceFromFields(fields: EarlyReturnFields, fallback: EarlyReturnChoice): EarlyReturnChoice {
  const billing = fields.billing === "END_AT_PICKUP" || fields.billing === "KEEP_TO_AGREED_END" ? fields.billing : fallback.billing;
  const unusedDays = fields.unusedDays === "CREDIT" || fields.unusedDays === "REFUND" || fields.unusedDays === "KEEP" ? fields.unusedDays : fallback.unusedDays;
  let feeCents: EarlyReturnChoice["feeCents"] = fallback.feeCents;
  if (fields.fee === "AGREED_TERMS") feeCents = "AGREED_TERMS";
  else if (fields.fee === "NONE") feeCents = 0;
  else if (fields.fee === "CUSTOM") {
    const cents = dollarsToCents(fields.feeDollars ?? "");
    if (cents === null) throw new Error("Fee: enter dollars and cents, like 50 or 49.99.");
    feeCents = cents;
  }
  const reason = fields.feeReason?.trim();
  return { billing, unusedDays, feeCents, ...(reason ? { feeReason: reason } : {}) };
}

/** The fields that would rebuild a choice, for filling the form back in. */
export function fieldsFromChoice(choice: EarlyReturnChoice): Required<EarlyReturnFields> {
  const fee = choice.feeCents === "AGREED_TERMS" ? "AGREED_TERMS" : choice.feeCents === 0 ? "NONE" : "CUSTOM";
  return {
    billing: choice.billing,
    unusedDays: choice.unusedDays,
    fee,
    feeDollars: typeof choice.feeCents === "number" && choice.feeCents > 0 ? (choice.feeCents / 100).toFixed(2) : "",
    feeReason: choice.feeReason ?? "",
  };
}
