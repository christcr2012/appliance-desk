import { prisma } from "@/lib/prisma";
import { getEffectiveSetupTaxTreatment } from "@/domains/billing/setup-tax-policy-version";
import { DEFAULT_SIGNING_CHARGE_SETTINGS } from "@/domains/billing/signing-charges";
import { getMandatorySigningPolicy } from "@/domains/billing/signing-mandatory-policy";
import { previewEstimateAllInCharges } from "./all-in-preview";

/**
 * OWNER-only review data. This function must never be called from the public
 * estimate link, because its partial known amounts are not a customer offer.
 * Readers must independently require OWNER/ADMIN before rendering it.
 */
export async function getPrivateEstimateAllInReview(estimateId: string) {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: {
      id: true, customerId: true, depositCents: true,
      customer: { select: { isBusiness: true, isPropertyManager: true } },
      lineItems: { select: {
        id: true, serviceAddressId: true, quantity: true, monthlyPriceCents: true,
        oneTimeFeeCents: true, serviceAddress: { select: { line1: true, city: true } },
        package: { select: { components: { select: { quantity: true } } } },
      } },
    },
  });
  if (!estimate) return null;
  const addressIds = [...new Set(estimate.lineItems.map(row => row.serviceAddressId).filter(
    (value): value is string => !!value,
  ))];
  const [settings, reviewedTax, active, mandatoryPolicy] = await Promise.all([
    prisma.businessSettings.findUnique({ where: { id: "singleton" } }),
    getEffectiveSetupTaxTreatment(),
    prisma.rentalAgreement.findMany({
      where: { ...(estimate.customerId ? { customerId: estimate.customerId } : { id: { in: [] } }),
        serviceAddressId: { in: addressIds }, status: "ACTIVE" },
      select: { serviceAddressId: true },
    }),
    getMandatorySigningPolicy(),
  ]);
  return previewEstimateAllInCharges({
    lines: estimate.lineItems.map(row => ({
      id: row.id, serviceAddressId: row.serviceAddressId,
      addressLabel: row.serviceAddress ? row.serviceAddress.line1 + ", " + row.serviceAddress.city : null,
      quantity: row.quantity, monthlyPriceCents: row.monthlyPriceCents,
      oneTimeFeeCents: row.oneTimeFeeCents,
      machineCountPerUnit: row.package
        ? row.package.components.reduce((n, item) => n + item.quantity, 0)
        : null,
    })),
    depositCents: estimate.depositCents,
    applicability: mandatoryPolicy.decision,
    existingActiveAddressIds: active.map(row => row.serviceAddressId),
    businessCustomer: estimate.customer?.isBusiness ?? false,
    propertyManagerCustomer: estimate.customer?.isPropertyManager ?? false,
    settings: {
      setupFeeCents: settings?.administrativeSetupFeeCents ?? DEFAULT_SIGNING_CHARGE_SETTINGS.setupFeeCents,
      largeOrderMachineThreshold: settings?.largeOrderMachineThreshold ?? DEFAULT_SIGNING_CHARGE_SETTINGS.largeOrderMachineThreshold,
      businessRequiresDownPayment: settings?.businessRequiresDownPayment ?? DEFAULT_SIGNING_CHARGE_SETTINGS.businessRequiresDownPayment,
      setupFeeTaxTreatment: reviewedTax,
      deliveryFeeCents: settings?.oneTimeDeliveryFeeCents ?? 0,
      installationFeeCents: settings?.oneTimeInstallationFeeCents ?? 0,
      removalFeeCents: settings?.oneTimeRemovalFeeCents ?? 0,
      damageWaiverEnabled: settings?.damageWaiverEnabled ?? false,
      depositEnabled: settings?.depositEnabled ?? false,
    },
  });
}
