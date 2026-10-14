import { buildSigningChargePlan, type SigningChargeSettings } from "@/domains/billing/signing-charges";

/**
 * W-22FIN: diagnostics for an estimate that predates a complete charge-bearing
 * contract. This is a PRIVATE preview, never a permission to send, accept or
 * charge. The caller must use stored records; no price comes from the browser.
 */
export type EstimatePreviewLine = {
  id: string;
  serviceAddressId: string | null;
  addressLabel: string | null;
  quantity: number;
  monthlyPriceCents: number;
  oneTimeFeeCents: number;
  machineCountPerUnit: number | null;
};
export type EstimatePreviewSettings = SigningChargeSettings & {
  deliveryFeeCents: number;
  installationFeeCents: number;
  removalFeeCents: number;
  damageWaiverEnabled: boolean;
  depositEnabled: boolean;
};
export type EstimatePreviewInput = {
  lines: readonly EstimatePreviewLine[];
  depositCents: number;
  settings: EstimatePreviewSettings;
  existingActiveAddressIds: readonly string[];
  businessCustomer: boolean;
  propertyManagerCustomer: boolean;
  /** A missing explicit decision is unresolved, not a zero-dollar fee. */
  applicability?: Readonly<{
    delivery: "UNDECIDED" | "REQUIRED" | "NOT_APPLICABLE";
    installation: "UNDECIDED" | "REQUIRED" | "NOT_APPLICABLE";
    removal: "UNDECIDED" | "REQUIRED" | "NOT_APPLICABLE";
    damageWaiver: "UNDECIDED" | "REQUIRED" | "NOT_APPLICABLE";
    retailDelivery: "UNDECIDED" | "REQUIRED" | "EXEMPT";
  }>;
};
export type EstimateLocationPreview = {
  serviceAddressId: string;
  addressLabel: string;
  itemIds: string[];
  machines: number;
  monthlyRentCents: number;
  quotedOneTimeCents: number;
  setupFeeCents: number;
  firstMonthDownPaymentCents: number;
  disclosedKnownCents: number;
};
export type EstimateAllInPreview = {
  status: "REVIEW_REQUIRED";
  eligibleForCustomerApproval: false;
  eligibleForDepositCheckout: false;
  eligibleForBindingSend: false;
  reasons: string[];
  locations: EstimateLocationPreview[];
  unassignedLineCount: number;
  known: {
    monthlyRentCents: number;
    quotedOneTimeCents: number;
    setupFeeCents: number;
    firstMonthDownPaymentCents: number;
    requestedDepositCents: number;
    knownSubtotalCents: number;
  } | null;
  missingCategories: string[];
};

const cents = (value: number) => Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000_000;
function total(values: readonly number[]): number | null {
  if (values.some(value => !cents(value))) return null;
  const answer = values.reduce((sum, value) => sum + value, 0);
  return cents(answer) ? answer : null;
}
function unresolved(reason: string, messages: string[]) {
  if (!messages.includes(reason)) messages.push(reason);
}
function status(reasons: string[], locations: EstimateLocationPreview[], unassignedLineCount: number,
  known: EstimateAllInPreview["known"], categories: string[]): EstimateAllInPreview {
  return { status: "REVIEW_REQUIRED", eligibleForCustomerApproval: false,
    eligibleForBindingSend: false, eligibleForDepositCheckout: false,
    reasons: [...new Set(reasons)], locations, unassignedLineCount,
    known, missingCategories: [...new Set(categories)] };
}

/**
 * Creates an explicit per-location review surface instead of silently
 * treating legacy one-time estimate lines as an all-in signing offer.
 * Every disputed category remains unresolved until an immutable, reviewed
 * charge snapshot and location-specific tax evidence are stored.
 */
export function previewEstimateAllInCharges(input: EstimatePreviewInput): EstimateAllInPreview {
  const reasons: string[] = [];
  const missing: string[] = [];
  const grouped = new Map<string, EstimateLocationPreview>();
  let unassignedLineCount = 0;

  if (!input.lines.length || input.lines.length > 1000) {
    unresolved("A usable estimate requires one or more reviewed rental lines.", reasons);
  }
  if (!cents(input.depositCents)) {
    unresolved("The requested deposit must be a valid nonnegative cent amount.", reasons);
  }
  for (const line of input.lines) {
    if (!line.id || !Number.isSafeInteger(line.quantity) || line.quantity <= 0
      || line.quantity > 10000 || !cents(line.monthlyPriceCents)
      || !cents(line.oneTimeFeeCents)) {
      unresolved("An estimate line has an invalid quantity or amount.", reasons);
      continue;
    }
    if (!line.serviceAddressId || !line.addressLabel) {
      unassignedLineCount++;
      unresolved("Every rental line needs a verified delivery location.", reasons);
      continue;
    }
    if (!Number.isSafeInteger(line.machineCountPerUnit) || line.machineCountPerUnit === null
      || line.machineCountPerUnit < 1 || line.machineCountPerUnit > 1000) {
      unresolved("Rental machine count must be derived from an actual package or reviewed inventory.", reasons);
      continue;
    }
    const machines = line.quantity * line.machineCountPerUnit;
    const rent = line.quantity * line.monthlyPriceCents;
    const oneTime = line.quantity * line.oneTimeFeeCents;
    if (!cents(machines) || !cents(rent) || !cents(oneTime)) {
      unresolved("Rental line totals are outside the supported safe cent range.", reasons);
      continue;
    }
    let location = grouped.get(line.serviceAddressId);
    if (!location) {
      location = { serviceAddressId: line.serviceAddressId, addressLabel: line.addressLabel,
        itemIds: [], machines: 0, monthlyRentCents: 0, quotedOneTimeCents: 0,
        setupFeeCents: 0, firstMonthDownPaymentCents: 0, disclosedKnownCents: 0 };
      grouped.set(line.serviceAddressId, location);
    } else if (location.addressLabel !== line.addressLabel) {
      unresolved("Conflicting address labels must be reconciled before approval.", reasons);
    }
    location.itemIds.push(line.id);
    location.machines += machines;
    location.monthlyRentCents += rent;
    location.quotedOneTimeCents += oneTime;
    if (![location.machines, location.monthlyRentCents, location.quotedOneTimeCents].every(cents)) {
      unresolved("A location total exceeds supported integer-cent bounds.", reasons);
    }
  }
  if (!grouped.size) unresolved("No complete location quote is available.", reasons);
  const locations = [...grouped.values()].sort((a, b) => a.serviceAddressId.localeCompare(b.serviceAddressId));
  const sourceOk = reasons.length === 0;
  if (sourceOk) {
    try {
      const plan = buildSigningChargePlan({
        settings: input.settings,
        locations: locations.map(row => ({
          serviceAddressId: row.serviceAddressId, machineCount: row.machines,
          firstMonthRentCents: row.monthlyRentCents,
          newRentalAtLocation: true,
          existingActiveRental: input.existingActiveAddressIds.includes(row.serviceAddressId),
          deliveryRequired: true,
        })),
        paidInFullInAdvance: false,
        businessCustomer: input.businessCustomer,
        propertyManagerCustomer: input.propertyManagerCustomer,
      });
      for (const amount of plan.locations) {
        const row = grouped.get(amount.serviceAddressId)!;
        row.setupFeeCents = amount.setupFeeCents;
        row.firstMonthDownPaymentCents = amount.downPaymentCents;
        row.disclosedKnownCents = total([row.quotedOneTimeCents, row.setupFeeCents,
          row.firstMonthDownPaymentCents]) ?? -1;
      }
    } catch (error) {
      unresolved(error instanceof Error ? error.message : "Signing fee calculation needs review.", reasons);
    }
  }
  if (input.settings.setupFeeTaxTreatment === "UNDECIDED") {
    unresolved("Setup-fee tax requires a CPA-backed effective policy.", reasons);
    missing.push("setup-fee tax classification");
  }
  // Classification alone is not a tax calculation. Actual effective-dated
  // jurisdiction versions and applicable exemptions must be frozen separately.
  if (locations.some(row => row.setupFeeCents > 0)) {
    unresolved("Location-specific setup tax rates and jurisdiction evidence are not frozen.", reasons);
    missing.push("location-specific setup sales tax");
  }
  const fees: Array<["delivery" | "installation" | "removal", number, string]> = [
    ["delivery", input.settings.deliveryFeeCents, "delivery fee"],
    ["installation", input.settings.installationFeeCents, "installation fee"],
    ["removal", input.settings.removalFeeCents, "removal fee"],
  ];
  for (const [key, amount, label] of fees) {
    if (!cents(amount)) {
      unresolved("Configured " + label + " is invalid.", reasons);
    } else if (input.applicability?.[key] === undefined || input.applicability[key] === "UNDECIDED") {
      unresolved("Applicability of the " + label + " has not been reviewed.", reasons);
      missing.push(label);
    } else if (input.applicability[key] === "REQUIRED") {
      unresolved("A required " + label + " must be allocated and frozen for every eligible location.", reasons);
      missing.push(label + " allocation");
    }
  }
  if (input.settings.damageWaiverEnabled && input.applicability?.damageWaiver !== "NOT_APPLICABLE") {
    unresolved("Damage waiver eligibility, price and taxability require review.", reasons);
    missing.push("damage waiver");
  }
  if (input.settings.depositEnabled && input.depositCents === 0) {
    unresolved("Refundable deposit is enabled but has no reviewed amount.", reasons);
    missing.push("refundable deposit");
  }
  if (!input.applicability || input.applicability.retailDelivery === "UNDECIDED") {
    unresolved("Colorado retail delivery fee applicability/exemption requires review.", reasons);
    missing.push("retail delivery fee or exemption");
  } else if (input.applicability.retailDelivery === "REQUIRED") {
    unresolved("Retail delivery fee must be allocated from a dated verified rate.", reasons);
    missing.push("retail delivery fee rate");
  }
  // Initial rental taxes, optional upgrades, waiver taxes and other
  // mandatory rules must be reviewed at the actual customer addresses.
  missing.push("effective-dated rental tax and exemption review");
  unresolved("The legacy estimate has no owner-reviewed immutable all-in quote snapshot.", reasons);

  const known = sourceOk && locations.every(row => cents(row.disclosedKnownCents))
    ? (() => {
      const monthlyRentCents = total(locations.map(row => row.monthlyRentCents));
      const quotedOneTimeCents = total(locations.map(row => row.quotedOneTimeCents));
      const setupFeeCents = total(locations.map(row => row.setupFeeCents));
      const firstMonthDownPaymentCents = total(locations.map(row => row.firstMonthDownPaymentCents));
      const knownSubtotalCents = total([...locations.map(row => row.disclosedKnownCents), input.depositCents]);
      if ([monthlyRentCents, quotedOneTimeCents, setupFeeCents,
        firstMonthDownPaymentCents, knownSubtotalCents].some(x => x === null)) return null;
      return { monthlyRentCents: monthlyRentCents!, quotedOneTimeCents: quotedOneTimeCents!,
        setupFeeCents: setupFeeCents!, firstMonthDownPaymentCents: firstMonthDownPaymentCents!,
        requestedDepositCents: input.depositCents, knownSubtotalCents: knownSubtotalCents! };
    })() : null;
  return status(reasons, locations, unassignedLineCount, known, missing);
}
