import { businessDateFromKey, businessDateKey } from "@/lib/business-date";

export type RetailDeliveryFeeDecision = {
  status: "NOT_APPLICABLE_LEASE_ELECTION" | "EXEMPT_SMALL_BUSINESS" | "APPLIES" | "UNDECIDED";
  startsOn: Date | null;
  reason: string;
};

type Frequency = "MONTHLY" | "QUARTERLY" | "ANNUAL";
type Handling = "UNDECIDED" | "COLLECT_FROM_CUSTOMER" | "PAY_MYSELF";
type Election = "UNDECIDED" | "PAY_ON_ACQUISITION" | "COLLECT_ON_RENTALS";

function validatedDate(value: Date, label: string): string {
  if (!Number.isFinite(value.getTime())) throw new Error(label + " is not a valid date.");
  return businessDateKey(value);
}
function fromKey(value: string): Date {
  const date = businessDateFromKey(value);
  if (!date) throw new Error("Could not resolve Colorado calendar date.");
  return date;
}
function assertCents(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + " must be nonnegative integer cents.");
}

/** First filing-period start not earlier than 90 calendar days after crossing. */
export function rdfNewBusinessStartsOn(crossedOn: Date, frequency: Frequency): Date {
  const [year, month, day] = validatedDate(crossedOn, "Threshold crossing").split("-").map(Number);
  const eligible = new Date(Date.UTC(year!, month! - 1, day! + 90));
  let y = eligible.getUTCFullYear();
  let m = eligible.getUTCMonth() + 1;
  if (frequency === "ANNUAL") {
    if (m !== 1 || eligible.getUTCDate() !== 1) y += 1;
    return fromKey(`${y}-01-01`);
  }
  if (frequency === "QUARTERLY") {
    const q = Math.floor((m - 1) / 3) * 3 + 1;
    if (m !== q || eligible.getUTCDate() !== 1) m = q + 3;
    else m = q;
  } else if (eligible.getUTCDate() !== 1) {
    m += 1;
  }
  if (m > 12) { y += 1; m -= 12; }
  return fromKey(`${y}-${String(m).padStart(2, "0")}-01`);
}

/**
 * Explain whether Colorado's retail delivery fee applies to a new sale.
 * Missing legal/owner decisions are not silently interpreted as zero due.
 * A rental election cannot suppress the fee for a goods sale.
 */
export function retailDeliveryFeeStatus(input: {
  today: Date;
  saleType: "RENTAL" | "GOODS";
  election: Election;
  previousYearRetailCents: number;
  currentYearRetailCents: number;
  thresholdCents: number;
  thresholdCrossedOn: Date | null;
  frequency: Frequency;
  handling: Handling;
  cpaConfirmedOn: Date | null;
}): RetailDeliveryFeeDecision {
  const today = validatedDate(input.today, "Today");
  assertCents(input.previousYearRetailCents, "Prior-year sales");
  assertCents(input.currentYearRetailCents, "Current-year sales");
  assertCents(input.thresholdCents, "Sales threshold");
  if (input.cpaConfirmedOn) validatedDate(input.cpaConfirmedOn, "CPA confirmation");
  if (input.saleType === "RENTAL") {
    if (input.election === "PAY_ON_ACQUISITION") {
      return {
        status: "NOT_APPLICABLE_LEASE_ELECTION",
        startsOn: null,
        reason: "The business elected to pay acquisition tax on short-term rental equipment.",
      };
    }
    if (input.election === "UNDECIDED") {
      return { status: "UNDECIDED", startsOn: null, reason: "Choose the rental purchase-tax election first." };
    }
  }
  let startsOn: Date | null = null;
  if (input.previousYearRetailCents > input.thresholdCents) {
    startsOn = fromKey(today.slice(0, 4) + "-01-01");
  } else if (input.previousYearRetailCents > 0 || input.currentYearRetailCents <= input.thresholdCents) {
    return {
      status: "EXEMPT_SMALL_BUSINESS", startsOn: null,
      reason: "Retail sales did not exceed the applicable small-business threshold.",
    };
  } else if (input.thresholdCrossedOn) {
    startsOn = rdfNewBusinessStartsOn(input.thresholdCrossedOn, input.frequency);
    if (today < businessDateKey(startsOn)) {
      return {
        status: "EXEMPT_SMALL_BUSINESS", startsOn,
        reason: "New-business exemption continues until the first qualifying filing period after 90 days.",
      };
    }
  } else {
    return {
      status: "UNDECIDED", startsOn: null,
      reason: "Record the first date this new business exceeded its sales threshold.",
    };
  }
  if (input.handling === "UNDECIDED") {
    return { status: "UNDECIDED", startsOn, reason: "Owner must choose whether customers or the business pay the fee." };
  }
  if (!input.cpaConfirmedOn) {
    return { status: "UNDECIDED", startsOn, reason: "The fee status still needs CPA confirmation." };
  }
  return {
    status: "APPLIES", startsOn,
    reason: input.handling === "COLLECT_FROM_CUSTOMER"
      ? "The customer pays a separate retail delivery fee on qualifying sales."
      : "The business pays the retail delivery fee without a separate customer charge.",
  };
}

export function rdfRateForSale(
  saleOn: Date,
  rates: ReadonlyArray<{ effectiveOn: Date; amountCents: number; id: string }>,
): { id: string; amountCents: number } | null {
  const key = validatedDate(saleOn, "Sale date");
  const applicable = rates.filter(rate => {
    assertCents(rate.amountCents, "Delivery fee amount");
    return validatedDate(rate.effectiveOn, "Rate effective date") <= key;
  }).sort((a, b) => businessDateKey(b.effectiveOn).localeCompare(businessDateKey(a.effectiveOn)));
  return applicable[0] ? { id: applicable[0].id, amountCents: applicable[0].amountCents } : null;
}
