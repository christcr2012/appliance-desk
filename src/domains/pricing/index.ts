import { prisma } from "@/lib/prisma";
import { cache } from "react";

// dollarsToCents/formatCents live in ./money (no database import) so
// client components can import them without pulling @/lib/prisma (and
// the `pg` driver underneath it) into the browser bundle — see that
// file's comment. Re-exported here so every existing SERVER-side import
// of these from "@/domains/pricing" keeps working unchanged.
export { dollarsToCents, formatCents } from "./money";

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
