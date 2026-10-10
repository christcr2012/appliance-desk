import { Prisma } from "@prisma/client";

/**
 * Provider dollars and unit counts are telemetry. Never accept a JS float:
 * decimal.js receives the original provider string without binary rounding.
 */
const decimal24_10 = /^-?(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,10})?$/;
export type ExactTelecomDecimal = string | Prisma.Decimal;
export type TelecomChargeConvention = "TWILIO_RESOURCE" | "TWILIO_USAGE";

export function telecomDecimal(value: ExactTelecomDecimal): Prisma.Decimal {
  if (typeof value !== "string" && !(value instanceof Prisma.Decimal)) {
    throw new TypeError("Telecom amounts require an exact decimal string or Prisma.Decimal.");
  }
  const raw = typeof value === "string" ? value : value.toString();
  if (!decimal24_10.test(raw)) {
    throw new RangeError("Telecom decimal exceeds Decimal(24,10), is not finite, or is not canonical.");
  }
  return new Prisma.Decimal(raw);
}

/** Twilio resource prices are negative for a charge, Usage prices positive. */
export function reportedTelecomSpend(
  value: ExactTelecomDecimal | null,
  convention: TelecomChargeConvention,
): Prisma.Decimal | null {
  if (value === null) return null;
  const parsed = telecomDecimal(value);
  return convention === "TWILIO_RESOURCE" ? parsed.negated() : parsed;
}

export type TelecomAmountObservation = {
  amount: ExactTelecomDecimal | null;
  currency: string;
  classification: "ESTIMATED" | "PROVIDER_REPORTED" | "INVOICE_RECONCILED";
};

/**
 * A caller supplies exactly one evidence basis and one currency. A missing
 * provider price poisons the aggregate as UNKNOWN, never silently adds $0.
 * Source supersession filtering happens before invoking this helper (L12).
 */
export function sumComparableTelecomAmounts(
  rows: readonly TelecomAmountObservation[],
): { currency: string; classification: TelecomAmountObservation["classification"]; amount: Prisma.Decimal } | null {
  if (rows.length === 0) return null;
  const first = rows[0]!;
  if (!/^[A-Z]{3}$/.test(first.currency)) {
    throw new RangeError("Invalid telecom currency.");
  }
  let total = new Prisma.Decimal(0);
  for (const row of rows) {
    if (row.currency !== first.currency || row.classification !== first.classification) {
      throw new Error("Cannot sum currencies or telecom evidence layers.");
    }
    if (row.amount === null) return null;
    total = total.plus(telecomDecimal(row.amount));
  }
  return { currency: first.currency, classification: first.classification, amount: total };
}

/** The single display/statement boundary; rounds signed aggregate exactly once. */
export function roundTelecomTotalToCents(value: ExactTelecomDecimal | null): number | null {
  if (value === null) return null;
  const cents = telecomDecimal(value).times(100)
    .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  if (cents.abs().greaterThan(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError("Telecom cent result is outside safe integer bounds.");
  }
  return cents.toNumber();
}
