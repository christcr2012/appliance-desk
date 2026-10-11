/** W-22A: pure, non-charging plan for mandatory signing amounts per location. */
export type SigningChargeSettings = {
  setupFeeCents: number;
  largeOrderMachineThreshold: number;
  businessRequiresDownPayment: boolean;
  setupFeeTaxTreatment: "UNDECIDED" | "TAXABLE" | "NOT_TAXABLE";
};
export const DEFAULT_SIGNING_CHARGE_SETTINGS: SigningChargeSettings = {
  setupFeeCents: 4500, largeOrderMachineThreshold: 5,
  businessRequiresDownPayment: true, setupFeeTaxTreatment: "UNDECIDED",
};
export type SigningLocation = {
  serviceAddressId: string;
  machineCount: number;
  firstMonthRentCents: number;
  newRentalAtLocation: boolean;
  /** Existing active rental at this address must not get a duplicate setup charge. */
  existingActiveRental: boolean;
  deliveryRequired: boolean;
  setupFeeOverrideCents?: number;
  setupFeeOverrideReason?: string;
};
export type SigningChargeInput = {
  settings: SigningChargeSettings;
  locations: SigningLocation[];
  businessCustomer: boolean;
  propertyManagerCustomer: boolean;
  paidInFullInAdvance: boolean;
};
export type SigningLocationAmount = {
  serviceAddressId: string; setupFeeCents: number; downPaymentCents: number;
  signingTotalCents: number; feeOverrideReason: string | null;
};
function nonnegativeCents(cents: number, label: string): number {
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > 100_000_000_000)
    throw new Error(`${label} must be a valid, nonnegative dollar amount.`);
  return cents;
}
function sumCents(amounts: number[]): number {
  const total = amounts.reduce((sum, amount) => sum + amount, 0);
  if (!Number.isSafeInteger(total)) throw new Error("The order total is too large.");
  return total;
}
export function buildSigningChargePlan(input: SigningChargeInput) {
  const { settings, locations } = input;
  nonnegativeCents(settings.setupFeeCents, "Setup fee");
  if (!Number.isInteger(settings.largeOrderMachineThreshold) || settings.largeOrderMachineThreshold < 1 || settings.largeOrderMachineThreshold > 1000)
    throw new Error("Choose a machine threshold from 1 to 1,000.");
  if (!locations.length || locations.length > 500) throw new Error("Choose at least one delivery location.");
  const seen = new Set<string>();
  let machines = 0;
  for (const location of locations) {
    if (!location.serviceAddressId || location.serviceAddressId.length > 200 || seen.has(location.serviceAddressId))
      throw new Error("Every service address must be present exactly once.");
    seen.add(location.serviceAddressId);
    if (!Number.isSafeInteger(location.machineCount) || location.machineCount < 1)
      throw new Error("Each location needs at least one machine.");
    machines += location.machineCount;
    nonnegativeCents(location.firstMonthRentCents, "First month rent");
  }
  const largeOrder = machines >= settings.largeOrderMachineThreshold ||
    (settings.businessRequiresDownPayment && (input.businessCustomer || input.propertyManagerCustomer));
  const details: SigningLocationAmount[] = locations.map((location) => {
    const recommendedFee = location.deliveryRequired && location.newRentalAtLocation && !location.existingActiveRental
      ? settings.setupFeeCents : 0;
    const changed = location.setupFeeOverrideCents !== undefined;
    const setupFeeCents = changed ? nonnegativeCents(location.setupFeeOverrideCents!, "Adjusted fee") : recommendedFee;
    const reason = location.setupFeeOverrideReason?.trim() ?? "";
    if (changed && setupFeeCents !== recommendedFee && (reason.length < 5 || reason.length > 500))
      throw new Error("Give a reason (5–500 characters) for changing the setup fee.");
    const downPaymentCents = largeOrder && !input.paidInFullInAdvance ? location.firstMonthRentCents : 0;
    return {
      serviceAddressId: location.serviceAddressId,
      setupFeeCents, downPaymentCents,
      signingTotalCents: sumCents([setupFeeCents, downPaymentCents]),
      feeOverrideReason: setupFeeCents !== recommendedFee ? reason : null,
    };
  });
  const setupTotalCents = sumCents(details.map((item) => item.setupFeeCents));
  const downPaymentTotalCents = sumCents(details.map((item) => item.downPaymentCents));
  return {
    largeOrder, machineCount: machines, locations: details,
    setupTotalCents, downPaymentTotalCents,
    amountDueAtSigningCents: sumCents([setupTotalCents, downPaymentTotalCents]),
    requiresTaxReview: setupTotalCents > 0 && settings.setupFeeTaxTreatment === "UNDECIDED",
  };
}
