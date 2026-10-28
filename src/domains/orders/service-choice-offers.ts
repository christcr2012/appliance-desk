// FEETAX-1 (S4): server-side assembly of an estimate's service-choice
// offers. The inputs come only from the business's own records — the
// owner settings, the estimate's frozen delivery charges and the
// packages on its lines — so the price a customer is shown at ordering
// is the price the choice record saves. The approval transaction
// recomputes these inside its row lock (serviceChoiceOffersInTx); the
// page uses the read-only variant for display, and the binding record
// is always the in-transaction one.

import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import {
  computeServiceChoiceOffers,
  readSelfInstallAllowedCategories,
  serviceCategoriesForOrder,
  type ServiceChoiceOffer,
} from "@/domains/orders/service-choices";

export type ServiceChoiceOfferInputs = {
  deliveryPriceCents: number | null;
  pickupOnly: boolean;
  installationFeeCents: number;
  removalFeeCents: number;
  haulAwayFeeCents: number | null;
  applianceTypeSlugs: string[];
  selfInstallAllowedCategories: string[];
};

type EstimateShape = {
  id: string;
  deliveryZoneSnapshot: unknown;
  reviewedQuoteFingerprint: string | null;
};

async function assembleInputs(
  db: Prisma.TransactionClient,
  estimate: EstimateShape,
): Promise<ServiceChoiceOfferInputs> {
  const { isPickupOnly, currentLocations } = await import("@/domains/delivery/snapshot");
  const { frozenDeliveryCentsInTx } = await import("@/domains/delivery/estimate-zone");
  const settings = await db.businessSettings.findUnique({
    where: { id: "singleton" },
    select: {
      oneTimeDeliveryFeeCents: true,
      oneTimeInstallationFeeCents: true,
      oneTimeRemovalFeeCents: true,
      oneTimeHaulAwayFeeCents: true,
      selfInstallAllowedCategories: true,
    },
  });
  const lines = await db.estimateLineItem.findMany({
    where: { estimateId: estimate.id },
    select: {
      serviceAddressId: true,
      package: {
        select: {
          components: { select: { applianceType: { select: { slug: true } } } },
        },
      },
    },
  });
  const addressIds = lines.map((line) => line.serviceAddressId);
  const pickupOnly = isPickupOnly(estimate.deliveryZoneSnapshot, addressIds);
  const locations = currentLocations(estimate.deliveryZoneSnapshot, addressIds);
  let deliveryPriceCents: number | null;
  if (locations.length) {
    // The order's total delivery charge is the sum of the frozen
    // per-address charges. If any address has no frozen charge yet,
    // the total is not known, so no delivery price is stated at all —
    // the choice record then simply has no delivery row and the tax
    // engine treats the line as not optional (the conservative side).
    deliveryPriceCents = 0;
    for (const location of locations) {
      const cents = await frozenDeliveryCentsInTx(db, estimate, location.serviceAddressId);
      if (cents === null) { deliveryPriceCents = null; break; }
      deliveryPriceCents += cents;
    }
  } else {
    // No priced address on the order: the flat one-time delivery fee is
    // the same fallback the quote itself uses.
    deliveryPriceCents = settings?.oneTimeDeliveryFeeCents ?? 0;
  }
  return {
    deliveryPriceCents,
    pickupOnly,
    installationFeeCents: settings?.oneTimeInstallationFeeCents ?? 0,
    removalFeeCents: settings?.oneTimeRemovalFeeCents ?? 0,
    // 0 in settings means "not priced yet" — the service is not offered.
    haulAwayFeeCents:
      settings && settings.oneTimeHaulAwayFeeCents > 0
        ? settings.oneTimeHaulAwayFeeCents
        : null,
    applianceTypeSlugs: lines.flatMap(
      (line) => line.package?.components.map((c) => c.applianceType.slug) ?? [],
    ),
    selfInstallAllowedCategories: readSelfInstallAllowedCategories(
      settings?.selfInstallAllowedCategories,
    ),
  };
}

export async function serviceChoiceOffersInTx(
  tx: Prisma.TransactionClient,
  estimate: EstimateShape,
  dryerOutlet: "THREE_PRONG" | "FOUR_PRONG" | "GAS" | "UNKNOWN" | null,
): Promise<{ inputs: ServiceChoiceOfferInputs; offers: ServiceChoiceOffer[] }> {
  const inputs = await assembleInputs(tx, estimate);
  const offers = computeServiceChoiceOffers({
    ...inputs,
    categories: serviceCategoriesForOrder({
      applianceTypeSlugs: inputs.applianceTypeSlugs,
      dryerOutlet,
    }),
  });
  return { inputs, offers };
}

export async function serviceChoiceOfferInputsForEstimate(
  estimateId: string,
): Promise<ServiceChoiceOfferInputs | null> {
  const estimate = await prisma.estimate.findUnique({
    where: { id: estimateId },
    select: { id: true, deliveryZoneSnapshot: true, reviewedQuoteFingerprint: true },
  });
  if (!estimate) return null;
  return assembleInputs(prisma as unknown as Prisma.TransactionClient, estimate);
}
