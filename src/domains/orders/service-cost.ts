// FEETAX-1 (S5): what a service really costs, and the warning when a
// price is set far above that cost. Pricing services far above cost
// to shrink the taxed rent is not allowed, so Settings warns — it
// never blocks. Every input is an owner figure or a recorded trip:
// when any input is missing the answer is "no cost basis", and no
// warning is shown rather than an invented one.

export type ServiceCostInputs = {
  // One-way recorded road miles for a typical trip to the customer.
  miles: number | null;
  // The usual visit length (the owner's scheduling setting).
  minutes: number | null;
  // Owner settings; null until the owner enters them.
  truckCostPerMileCents: number | null;
  laborCostPerMinuteCents: number | null;
};

// The trip out and back, plus the time on site. Null when any input
// is missing — a partial cost would understate the real cost and
// cry wolf on honest prices.
export function typicalServiceCostCents(input: ServiceCostInputs): number | null {
  if (input.miles === null || input.minutes === null) return null;
  if (input.truckCostPerMileCents === null || input.laborCostPerMinuteCents === null)
    return null;
  const tripMiles = input.miles * 2;
  return Math.round(
    tripMiles * input.truckCostPerMileCents +
      input.minutes * input.laborCostPerMinuteCents,
  );
}

// True when the price is more than the owner's limit percent of the
// typical cost — the Settings warning condition.
export function priceExceedsCostLimit(args: {
  priceCents: number;
  typicalCostCents: number | null;
  limitPercent: number;
}): boolean {
  if (args.typicalCostCents === null || args.typicalCostCents <= 0) return false;
  return args.priceCents * 100 > args.typicalCostCents * args.limitPercent;
}
