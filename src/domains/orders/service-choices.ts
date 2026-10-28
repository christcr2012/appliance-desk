// FEETAX-1 (S4): the service choices a customer makes at ordering —
// delivery, installation, pickup at the end (REMOVAL) and haul-away —
// recorded as OrderServiceChoice rows. The record is the proof the tax
// engine needs before a service line may be treated as optional and
// separately stated: the price that was shown (even when the customer
// declined) and whether the free do-it-myself alternative was actually
// on the screen. Prices ALWAYS come from the server's own offer
// computation (settings + the frozen zone delivery charge), never from
// anything the client submits; a selection only picks who does the work.

import type { Prisma } from "@prisma/client";

export const SERVICE_CHOICE_SERVICES = [
  "DELIVERY",
  "INSTALLATION",
  "REMOVAL",
  "HAUL_AWAY",
] as const;
export type ServiceChoiceService = (typeof SERVICE_CHOICE_SERVICES)[number];
export type ServiceChoiceValue = "BY_BUSINESS" | "CUSTOMER_DOES_IT" | "NOT_NEEDED";

export type ServiceChoiceOffer = {
  service: ServiceChoiceService;
  // The price shown at ordering for having us do it, in cents.
  priceCents: number;
  // True only when the surface actually showed the free alternative.
  alternativeShown: boolean;
  // What the alternative is, in plain words for the screens.
  alternative: "PICKUP" | "SELF_INSTALL" | "RETURN_IT_YOURSELF" | "NO_HAUL_AWAY" | null;
};

export type ServiceChoiceOffersInput = {
  // The order's total delivery charge (frozen zone price, or the flat
  // one-time delivery fee when no zone price applies). Null when the
  // order has no deliverable address at all.
  deliveryPriceCents: number | null;
  // True when every address on the order is customer pickup — delivery
  // by us was never on the table, so the recorded choice is the
  // customer's by construction.
  pickupOnly: boolean;
  installationFeeCents: number;
  removalFeeCents: number;
  // Null until the business has a haul-away price (an owner setting);
  // an unpriced service is not offered and not recorded as chosen.
  haulAwayFeeCents: number | null;
  // Category tokens for what is on the order (see
  // serviceCategoriesForOrder): WASHER, DRYER_ELECTRIC, DRYER_GAS,
  // FRIDGE, FREEZER, OTHER.
  categories: string[];
  // Owner setting: categories a customer may install themselves. Gas is
  // never in it — a gas hookup needs a professional.
  selfInstallAllowedCategories: string[];
};

// Map what is on the order to the category tokens the self-install
// setting speaks in. A dryer counts as electric only when the intake
// answers prove it (a three- or four-prong outlet); a gas outlet makes
// it DRYER_GAS, and an unanswered intake leaves it DRYER_UNKNOWN —
// neither is ever in the allowed list, so the alternative stays hidden
// whenever a gas hookup is possible. That is the conservative reading
// of "gas appliances never offer self-install".
export function serviceCategoriesForOrder(input: {
  applianceTypeSlugs: string[];
  dryerOutlet: "THREE_PRONG" | "FOUR_PRONG" | "GAS" | "UNKNOWN" | null;
}): string[] {
  const categories = new Set<string>();
  for (const slug of input.applianceTypeSlugs) {
    if (slug === "washer") categories.add("WASHER");
    else if (slug === "refrigerator" || slug === "fridge") categories.add("FRIDGE");
    else if (slug === "freezer") categories.add("FREEZER");
    else if (slug === "dryer") {
      if (input.dryerOutlet === "THREE_PRONG" || input.dryerOutlet === "FOUR_PRONG")
        categories.add("DRYER_ELECTRIC");
      else if (input.dryerOutlet === "GAS") categories.add("DRYER_GAS");
      else categories.add("DRYER_UNKNOWN");
    } else categories.add("OTHER");
  }
  return [...categories];
}

// The owner setting is stored as JSON; read it defensively — anything
// that is not a list of category names means "no categories allowed",
// which hides the self-install alternative (the conservative side).
export function readSelfInstallAllowedCategories(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((value): value is string => typeof value === "string");
}

export function computeServiceChoiceOffers(
  input: ServiceChoiceOffersInput,
): ServiceChoiceOffer[] {
  const offers: ServiceChoiceOffer[] = [];
  // Delivery: the alternative is picking it up yourself. It was shown
  // whenever the ordering surface offered pickup (the zone choice) —
  // on a pickup-only order the alternative is not just shown, it is
  // the order itself.
  if (input.deliveryPriceCents !== null) {
    offers.push({
      service: "DELIVERY",
      priceCents: input.deliveryPriceCents,
      alternativeShown: true,
      alternative: "PICKUP",
    });
  }
  // Installation: the alternative is installing it yourself, shown
  // only when EVERY appliance on the order is one the owner allows
  // customers to install (a single gas or unknown-fuel appliance hides
  // it for the whole order — the honest record).
  const selfInstallAllowed =
    input.categories.length > 0 &&
    input.categories.every((category) =>
      input.selfInstallAllowedCategories.includes(category),
    );
  offers.push({
    service: "INSTALLATION",
    priceCents: input.installationFeeCents,
    alternativeShown: selfInstallAllowed,
    alternative: selfInstallAllowed ? "SELF_INSTALL" : null,
  });
  // Pickup at the end: the alternative is bringing the appliance back
  // yourself; the ordering surfaces always offer it.
  offers.push({
    service: "REMOVAL",
    priceCents: input.removalFeeCents,
    alternativeShown: true,
    alternative: "RETURN_IT_YOURSELF",
  });
  // Haul-away: offered only once the business has priced it. Declining
  // ("no thanks") is the alternative, and it is always shown.
  if (input.haulAwayFeeCents !== null) {
    offers.push({
      service: "HAUL_AWAY",
      priceCents: input.haulAwayFeeCents,
      alternativeShown: true,
      alternative: "NO_HAUL_AWAY",
    });
  }
  return offers;
}

// The choice recorded for a service the customer did not touch: "by
// us" for the services we perform by default — except delivery on a
// pickup-only order, which is the customer's by construction.
export function defaultServiceChoice(
  offer: ServiceChoiceOffer,
  pickupOnly: boolean,
): ServiceChoiceValue {
  if (offer.service === "DELIVERY" && pickupOnly) return "CUSTOMER_DOES_IT";
  return "BY_BUSINESS";
}

export type ServiceChoiceSelection = {
  service: ServiceChoiceService;
  choice: ServiceChoiceValue;
};

// Write the choice rows inside the caller's transaction (the order row
// is already locked there — approveEstimate locks the estimate before
// this runs). Prices and alternativeShown come from the server's own
// offers, never from the client's submission; a selection naming an
// unknown service, or claiming the free alternative for a service
// whose alternative was never shown, is rejected outright.
export async function recordServiceChoicesInTx(
  tx: Prisma.TransactionClient,
  args: {
    orderId: string;
    agreementId?: string | null;
    quoteVersion: number;
    offers: ServiceChoiceOffer[];
    selections: ServiceChoiceSelection[];
    pickupOnly: boolean;
    decidedAt?: Date;
  },
): Promise<{ service: ServiceChoiceService; choice: ServiceChoiceValue }[]> {
  const byService = new Map<ServiceChoiceService, ServiceChoiceSelection>();
  for (const selection of args.selections) {
    if (!SERVICE_CHOICE_SERVICES.includes(selection.service))
      throw new Error("Unknown service in the service choices.");
    if (byService.has(selection.service))
      throw new Error("Each service can be chosen only once.");
    byService.set(selection.service, selection);
  }
  const recorded: { service: ServiceChoiceService; choice: ServiceChoiceValue }[] = [];
  for (const offer of args.offers) {
    const selection = byService.get(offer.service);
    const choice = selection?.choice ?? defaultServiceChoice(offer, args.pickupOnly);
    if (choice === "CUSTOMER_DOES_IT" && !offer.alternativeShown)
      throw new Error(
        "That service has no do-it-yourself option on this order.",
      );
    await tx.orderServiceChoice.upsert({
      where: { orderId_service: { orderId: args.orderId, service: offer.service } },
      create: {
        orderId: args.orderId,
        agreementId: args.agreementId ?? null,
        service: offer.service,
        choice,
        offeredPriceCents: offer.priceCents,
        alternativeShown: offer.alternativeShown,
        quoteVersion: args.quoteVersion,
        decidedAt: args.decidedAt ?? new Date(),
      },
      update: {
        agreementId: args.agreementId ?? null,
        choice,
        offeredPriceCents: offer.priceCents,
        alternativeShown: offer.alternativeShown,
        quoteVersion: args.quoteVersion,
        decidedAt: args.decidedAt ?? new Date(),
      },
    });
    recorded.push({ service: offer.service, choice });
  }
  return recorded;
}

// Read path for billing and the desk screens: the order's recorded
// choices, keyed by service. Reads go through the owning order, so the
// caller's own customer/role filtering on the order applies first —
// there is deliberately no cross-order read of choice rows.
export async function readServiceChoicesForOrder(
  db: Prisma.TransactionClient,
  orderId: string,
): Promise<Map<ServiceChoiceService, {
  choice: ServiceChoiceValue;
  offeredPriceCents: number;
  alternativeShown: boolean;
}>> {
  const rows = await db.orderServiceChoice.findMany({
    where: { orderId },
    select: { service: true, choice: true, offeredPriceCents: true, alternativeShown: true },
  });
  return new Map(
    rows.map((row) => [
      row.service as ServiceChoiceService,
      {
        choice: row.choice as ServiceChoiceValue,
        offeredPriceCents: row.offeredPriceCents,
        alternativeShown: row.alternativeShown,
      },
    ]),
  );
}
