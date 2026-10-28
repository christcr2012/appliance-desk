import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { getBusinessSettings } from "@/domains/settings";
import { automaticFeatureReasons, shownFeatureKeys } from "./registry";
export { FEATURES, FEATURE_KEYS, isFeatureKey, isHrefHidden, automaticFeatureReasons, shownFeatureKeys, savedFeatureKeys } from "./registry";
export type { FeatureKey } from "./registry";

/** Read only. The switches never change who may open a page. */
export const getFeatureVisibility = cache(async () => {
  const [settings, activeTeam, customers, leads] = await Promise.all([
    getBusinessSettings(),
    prisma.user.count({ where: { role: { in: ["OWNER", "ADMIN", "STAFF"] }, archivedAt: null } }),
    prisma.customer.count({ where: { isPropertyManager: true } }),
    prisma.lead.count({ where: { isPropertyManager: true } }),
  ]);
  const stored = settings.shownFeatures;
  const automatic = automaticFeatureReasons({
    activeTeam, hasPropertyManager: customers > 0 || leads > 0, cashBudgetEnabled: settings.cashBudgetEnabled,
  });
  return { shown: shownFeatureKeys(stored, automatic), automatic };
});
export async function getShownFeatures() {
  return (await getFeatureVisibility()).shown;
}
