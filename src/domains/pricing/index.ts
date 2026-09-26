import { prisma } from "@/lib/prisma";
import { cache } from "react";

/** Cents → "$35" / "$34.50". Money is always integer cents — see docs/BUSINESS-RULES.md. */
export function formatCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dollars % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Every published appliance type shown on the public site, ordered the
 * way Chris configured them in /desk/settings. Only rows with
 * showOnWebsite=true are ever shown publicly — see
 * docs/BUSINESS-RULES.md ("new appliance categories are added as data").
 */
export const getPublishedApplianceTypes = cache(async () => {
  return prisma.applianceType.findMany({
    where: { showOnWebsite: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});
