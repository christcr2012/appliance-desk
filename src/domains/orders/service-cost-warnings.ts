// FEETAX-1 (S5): the Settings price-vs-cost warnings. Typical miles
// come from the business's own recorded route proofs (the road miles
// the owner reviewed for real orders); the visit length is the
// owner's usual-visit setting; the per-mile and per-minute costs are
// owner settings. Until those exist there is no warning — the check
// starts working on real figures, never invented ones.

import { prisma } from "@/lib/prisma";
import { formatMoney } from "@/lib/money-ui";
import { priceExceedsCostLimit, typicalServiceCostCents } from "./service-cost";

function proofMiles(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const miles = (raw as { miles?: unknown }).miles;
  return typeof miles === "number" && miles > 0 ? miles : null;
}

export async function servicePriceWarnings(): Promise<string[]> {
  const settings = await prisma.businessSettings.findUnique({
    where: { id: "singleton" },
    select: {
      oneTimeDeliveryFeeCents: true,
      oneTimeInstallationFeeCents: true,
      oneTimeRemovalFeeCents: true,
      oneTimeHaulAwayFeeCents: true,
      serviceFeeCostLimitPercent: true,
      truckCostPerMileCents: true,
      laborCostPerMinuteCents: true,
      defaultJobDurationMinutes: true,
    },
  });
  if (!settings) return [];
  const [estimates, agreements] = await Promise.all([
    prisma.estimate.findMany({
      select: { deliveryRouteProof: true },
      orderBy: { updatedAt: "desc" },
      take: 400,
    }),
    prisma.rentalAgreement.findMany({
      select: { deliveryRouteProof: true },
      orderBy: { updatedAt: "desc" },
      take: 400,
    }),
  ]);
  const miles = [...estimates, ...agreements]
    .map((row) => proofMiles(row.deliveryRouteProof))
    .filter((value): value is number => value !== null);
  const typicalMiles = miles.length
    ? miles.reduce((sum, value) => sum + value, 0) / miles.length
    : null;
  const typicalCostCents = typicalServiceCostCents({
    miles: typicalMiles,
    minutes: settings.defaultJobDurationMinutes,
    truckCostPerMileCents: settings.truckCostPerMileCents,
    laborCostPerMinuteCents: settings.laborCostPerMinuteCents,
  });
  if (typicalCostCents === null) return [];
  const services: { name: string; priceCents: number }[] = [
    { name: "Delivery", priceCents: settings.oneTimeDeliveryFeeCents },
    { name: "Installation", priceCents: settings.oneTimeInstallationFeeCents },
    { name: "Pickup at the end", priceCents: settings.oneTimeRemovalFeeCents },
    { name: "Haul-away", priceCents: settings.oneTimeHaulAwayFeeCents },
  ];
  return services
    .filter((service) =>
      priceExceedsCostLimit({
        priceCents: service.priceCents,
        typicalCostCents,
        limitPercent: settings.serviceFeeCostLimitPercent,
      }),
    )
    .map(
      (service) =>
        `${service.name} is priced at ${formatMoney(service.priceCents)}, well above what the trip typically costs (about ${formatMoney(typicalCostCents)}). Tax agencies can treat over-priced service fees as part of the taxed price.`,
    );
}
