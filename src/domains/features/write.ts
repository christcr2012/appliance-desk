import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { automaticFeatureReasons, isFeatureKey, savedFeatureKeys } from "./registry";
import type { FeatureKey } from "./registry";

/** Only a current OWNER may change a choice. Lock the row before reading/merging the list. */
export async function setFeatureShown(ownerId: string, requestedKey: string, checked: boolean) {
  if (!isFeatureKey(requestedKey)) throw new Error("This feature is not available.");
  if (typeof checked !== "boolean") throw new Error("Choose whether to show the feature.");
  const feature: FeatureKey = requestedKey;
  return prisma.$transaction(async tx => {
    await assertActiveTeamActor(tx, ownerId, ["OWNER"]);
    await tx.$queryRaw`SELECT "id" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE`;
    const settings = await tx.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { shownFeatures: true, cashBudgetEnabled: true },
    });
    const [activeTeam, managers, managerLeads] = await Promise.all([
      tx.user.count({ where: { role: { in: ["OWNER", "ADMIN", "STAFF"] }, archivedAt: null } }),
      tx.customer.count({ where: { isPropertyManager: true } }),
      tx.lead.count({ where: { isPropertyManager: true } }),
    ]);
    const automatic = automaticFeatureReasons({
      activeTeam, hasPropertyManager: managers > 0 || managerLeads > 0,
      cashBudgetEnabled: settings.cashBudgetEnabled,
    });
    if (automatic.has(feature)) throw new Error("This feature is already shown automatically.");
    const current = savedFeatureKeys(settings.shownFeatures);
    const before = [...current];
    if (checked) current.add(feature);
    else current.delete(feature);
    if (current.size === before.length && before.every(k => current.has(k))) return { changed: false };
    const after = [...current];
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { shownFeatures: after } });
    await tx.auditLog.create({ data: {
      userId: ownerId, action: "settings.features", entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { shownFeatures: before }, newValue: { shownFeatures: after },
    } });
    return { changed: true };
  });
}
