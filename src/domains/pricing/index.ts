import { prisma } from "@/lib/prisma";
import { cache } from "react";

/**
 * Dollars (as a human types them, e.g. 45 or 45.5) → integer cents.
 * The one place this conversion happens for /desk/settings' fee and
 * appliance-price forms, which are entered in dollars for a human but
 * always stored as integer cents — see docs/BUSINESS-RULES.md ("money
 * is stored as integer cents, never floating point").
 */
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

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
    where: { showOnWebsite: true, isActive: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
});
