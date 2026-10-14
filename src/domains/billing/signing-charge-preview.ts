import { prisma } from "@/lib/prisma";
import { getEffectiveSetupTaxTreatment } from "./setup-tax-policy-version";
import {
  buildSigningChargePlan,
  DEFAULT_SIGNING_CHARGE_SETTINGS,
  type SigningChargeInput,
  type SigningChargeSettings,
} from "./signing-charges";

/**
 * W-22: read-only estimate of signing amounts from stored agreements. No charge,
 * signature, invoice, booking, or provider operation is created by this module.
 * Until the approved charge snapshot/payment work lands, do not expose this
 * value as an amount that a customer has paid or owes.
 */
export type DraftSigningAgreement = {
  id: string;
  serviceAddressId: string;
  status: string;
  paidInFullInAdvance: boolean;
  lines: Array<{
    monthlyPriceCents: number;
    package: { components: Array<{ quantity: number }> } | null;
  }>;
};

export function calculateDraftSigningPreview(input: {
  agreements: DraftSigningAgreement[];
  existingActiveAddressIds: string[];
  businessCustomer: boolean;
  propertyManagerCustomer: boolean;
  settings: SigningChargeSettings;
  feeOverrides?: readonly { serviceAddressId: string; setupFeeCents: number; reason: string }[];
}) {
  const { agreements, existingActiveAddressIds, settings } = input;
  const overrides = new Map<string, { cents: number; reason: string }>();
  for (const item of input.feeOverrides ?? []) {
    if (!item.serviceAddressId || overrides.has(item.serviceAddressId)) {
      throw new Error("Duplicate or unknown location fee overrides require owner review.");
    }
    overrides.set(item.serviceAddressId, { cents: item.setupFeeCents, reason: item.reason });
  }
  if (!agreements.length || agreements.some((item) => item.status !== "DRAFT")) {
    throw new Error("Signing charges can only be previewed for draft agreements.");
  }
  const existing = new Set(existingActiveAddressIds);
  const byAddress = new Map<string, { machineCount: number; firstMonthRentCents: number }>();
  for (const agreement of agreements) {
    if (agreement.lines.length === 0) throw new Error("Add a rental item before reviewing signing charges.");
    let count = 0;
    let rent = 0;
    for (const line of agreement.lines) {
      const quantity = line.package
        ? line.package.components.reduce((sum, component) => sum + component.quantity, 0)
        : 1;
      if (!Number.isSafeInteger(quantity) || quantity < 1) throw new Error("Rental package has an invalid machine count.");
      if (!Number.isSafeInteger(line.monthlyPriceCents) || line.monthlyPriceCents < 0)
        throw new Error("Rental price must be nonnegative integer cents.");
      count += quantity;
      rent += agreement.paidInFullInAdvance ? 0 : line.monthlyPriceCents;
    }
    const previous = byAddress.get(agreement.serviceAddressId) ?? { machineCount: 0, firstMonthRentCents: 0 };
    byAddress.set(agreement.serviceAddressId, {
      machineCount: previous.machineCount + count,
      firstMonthRentCents: previous.firstMonthRentCents + rent,
    });
  }
  const planInput: SigningChargeInput = {
    settings,
    businessCustomer: input.businessCustomer,
    propertyManagerCustomer: input.propertyManagerCustomer,
    paidInFullInAdvance: agreements.every((agreement) => agreement.paidInFullInAdvance),
    locations: [...byAddress.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([serviceAddressId, amount]) => ({
      serviceAddressId,
      ...amount,
      deliveryRequired: true,
      newRentalAtLocation: true,
      existingActiveRental: existing.has(serviceAddressId),
      ...(overrides.has(serviceAddressId)
        ? { setupFeeOverrideCents: overrides.get(serviceAddressId)!.cents,
            setupFeeOverrideReason: overrides.get(serviceAddressId)!.reason }
        : {}),
    })),
  };
  if ([...overrides.keys()].some(id => !byAddress.has(id))) {
    throw new Error("An adjusted setup fee has no order location.");
  }
  const plan = buildSigningChargePlan(planInput);
  return {
    ...plan,
    // The presence of an owner-authored override is independent from whether
    // its cents happen to match today's configured recommended fee.
    // Keeping the reason makes Restore available even after settings change.
    locations: plan.locations.map(location => ({
      ...location,
      feeOverrideReason: overrides.get(location.serviceAddressId)?.reason ??
        location.feeOverrideReason,
    })),
  };
}

export async function getDraftSigningChargePreview(agreementId: string) {
  const selected = await prisma.rentalAgreement.findUnique({
    where: { id: agreementId },
    select: { id: true, status: true, customerId: true, sourceEstimateId: true },
  });
  if (!selected || selected.status !== "DRAFT") return null;
  const agreements = await prisma.rentalAgreement.findMany({
    where: {
      customerId: selected.customerId,
      ...(selected.sourceEstimateId ? { sourceEstimateId: selected.sourceEstimateId } : { id: agreementId }),
    },
    select: {
      id: true,
      serviceAddressId: true,
      status: true,
      paidInFullInAdvance: true,
      lines: { select: {
        monthlyPriceCents: true,
        package: { select: { components: { select: { quantity: true } } } },
      } },
    },
  });
  // An incomplete quote has no payable preview yet. Never invent a fee when
  // a sibling draft still needs its rental lines entered.
  if (agreements.length === 0 || agreements.some((agreement) => agreement.status !== "DRAFT" || agreement.lines.length === 0)) return null;
  const addressIds = [...new Set(agreements.map((agreement) => agreement.serviceAddressId))];
  const [customer, active, settings, overrides] = await Promise.all([
    prisma.customer.findUniqueOrThrow({
      where: { id: selected.customerId },
      select: { isBusiness: true, isPropertyManager: true },
    }),
    prisma.rentalAgreement.findMany({
      where: { serviceAddressId: { in: addressIds }, status: "ACTIVE" },
      select: { serviceAddressId: true },
    }),
    prisma.businessSettings.findUnique({ where: { id: "singleton" } }),
    prisma.signingSetupFeeOverride.findMany({
      where: { agreementId: { in: agreements.map(row => row.id) } },
      select: { agreementId: true, setupFeeCents: true, reason: true },
    }),
  ]);
  const addressByAgreement = new Map(agreements.map(row => [row.id, row.serviceAddressId]));
  return calculateDraftSigningPreview({
    agreements,
    existingActiveAddressIds: active.map((item) => item.serviceAddressId),
    feeOverrides: overrides.map(row => ({
      serviceAddressId: addressByAgreement.get(row.agreementId)!,
      setupFeeCents: row.setupFeeCents, reason: row.reason,
    })),
    businessCustomer: customer.isBusiness,
    propertyManagerCustomer: customer.isPropertyManager,
    settings: {
      setupFeeCents: settings?.administrativeSetupFeeCents ?? DEFAULT_SIGNING_CHARGE_SETTINGS.setupFeeCents,
      largeOrderMachineThreshold: settings?.largeOrderMachineThreshold ?? DEFAULT_SIGNING_CHARGE_SETTINGS.largeOrderMachineThreshold,
      businessRequiresDownPayment: settings?.businessRequiresDownPayment ?? DEFAULT_SIGNING_CHARGE_SETTINGS.businessRequiresDownPayment,
      setupFeeTaxTreatment: await getEffectiveSetupTaxTreatment(),
    },
  });
}
