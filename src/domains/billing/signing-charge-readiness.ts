/**
 * W-22C: independent, fail-closed pre-signing evaluation of prepared records.
 * This is NOT permission to send, freeze or charge. The approved tax category
 * and an immutable tax-inclusive payload are separate requirements.
 */
export type PreparedChargeFact = {
  agreementId: string;
  serviceAddressId: string;
  sourceFingerprint: string;
  machineCount: number;
  firstMonthRentCents: number;
  setupFeeCents: number;
  downPaymentCents: number;
  signingSubtotalCents: number;
  setupFeeTaxTreatment: string;
  frozenAt: Date | null;
};

export type SigningReadiness = {
  amountsReconciled: boolean;
  reasons: string[];
  totalSetupCents: number;
  totalDownPaymentCents: number;
  totalBeforeTaxCents: number;
  machineCount: number;
};

const MAX_MONEY = Number.MAX_SAFE_INTEGER;

function safeNonNegative(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MONEY;
}

/**
 * Check that all expected draft agreements have complete, coherent prepared
 * amounts. A tax setting, even if marked TAXABLE/NOT_TAXABLE, is not a CPA
 * approval for IN-79. Positive setup charges always need that separate gate.
 */
export function assessPreparedSigningCharges(
  expectedAgreementIds: readonly string[],
  charges: readonly PreparedChargeFact[],
): SigningReadiness {
  const reasons: string[] = [];
  const expected = new Set(expectedAgreementIds);
  if (!expected.size || expected.size !== expectedAgreementIds.length ||
    charges.length !== expected.size || charges.some((charge) => !expected.has(charge.agreementId)) ||
    new Set(charges.map((charge) => charge.agreementId)).size !== charges.length) {
    reasons.push("Prepare a complete, unique set of charges for every agreement in this order.");
  }
  const fingerprints = new Set(charges.map((charge) => charge.sourceFingerprint));
  if (fingerprints.size !== 1 || [...fingerprints].some((fingerprint) => !/^[0-9a-f]{64}$/.test(fingerprint))) {
    reasons.push("The prepared order has inconsistent source revisions; refresh the drafts.");
  }
  const locationsWithFees = new Set<string>();
  let setup = 0;
  let down = 0;
  let machines = 0;
  for (const charge of charges) {
    if (!charge.serviceAddressId ||
      ![charge.machineCount, charge.firstMonthRentCents, charge.setupFeeCents,
        charge.downPaymentCents, charge.signingSubtotalCents].every(safeNonNegative) ||
      charge.machineCount < 1 ||
      charge.signingSubtotalCents !== charge.setupFeeCents + charge.downPaymentCents ||
      (charge.downPaymentCents !== 0 && charge.downPaymentCents !== charge.firstMonthRentCents)) {
      reasons.push("An agreement has invalid or unreconciled machine, rent or signing amounts.");
      break;
    }
    if (charge.setupFeeCents > 0) {
      if (locationsWithFees.has(charge.serviceAddressId)) {
        reasons.push("A location has more than one setup fee allocation.");
      }
      locationsWithFees.add(charge.serviceAddressId);
    }
    if (charge.frozenAt !== null) {
      reasons.push("An agreement has already been frozen; no draft repricing is allowed.");
    }
    setup += charge.setupFeeCents;
    down += charge.downPaymentCents;
    machines += charge.machineCount;
  }
  const subtotal = setup + down;
  if (![setup, down, subtotal, machines].every(safeNonNegative)) {
    reasons.push("The total is outside the supported money or machine range.");
  }
  const amountsReconciled = reasons.length === 0;
  if (setup > 0) {
    if (charges.some((charge) => charge.setupFeeTaxTreatment === "UNDECIDED")) {
      reasons.push("The setup fee tax treatment is undecided (CPA decision IN-79).");
    } else if (charges.some((charge) =>
      !["TAXABLE", "NOT_TAXABLE"].includes(charge.setupFeeTaxTreatment))) {
      reasons.push("The setup fee tax classification is not recognized.");
    }
    // Even a chosen value in BusinessSettings is NOT the CPA decision.
    reasons.push("CPA approval of the setup fee tax treatment (IN-79) is still required.");
  }
  // No pathway in this module allows a prepared pre-tax subtotal to be used as
  // a frozen, all-in, customer-payable amount. That requires the next stage.
  if (!reasons.length) {
    reasons.push("A tax-inclusive signed snapshot and payment reconciliation are not implemented yet.");
  }
  return {
    amountsReconciled,
    reasons: [...new Set(reasons)],
    totalSetupCents: safeNonNegative(setup) ? setup : 0,
    totalDownPaymentCents: safeNonNegative(down) ? down : 0,
    totalBeforeTaxCents: safeNonNegative(subtotal) ? subtotal : 0,
    machineCount: safeNonNegative(machines) ? machines : 0,
  };
}
