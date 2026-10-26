import { prisma } from "@/lib/prisma";
import { getBackupStore, checkPrivateStoreReady } from "@/lib/photo-storage";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { businessDateKey } from "@/lib/business-date";

export const BACKUP_RETENTION_RECOMMENDED_DAYS = 30;
export function validateBackupRetentionDays(value: number): number {
  if (!Number.isInteger(value) || value < 7 || value > 365) {
    throw new Error("Choose between 7 and 365 whole days.");
  }
  return value;
}

export async function getBackupDashboard(now = new Date()) {
  const [settings, latestVerified, completePair, today, lastManual] = await Promise.all([
    prisma.businessSettings.findUnique({
      where: { id: "singleton" }, select: { backupRetentionDays: true },
    }),
    prisma.backupArtifact.findFirst({
      where: { kind: "DATABASE", state: "VERIFIED" }, orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, verifiedAt: true, sizeBytes: true },
    }),
    prisma.backupArtifact.findFirst({
      where: { kind: "DATABASE", state: "VERIFIED",
        mediaManifests: { some: { kind: "MEDIA_MANIFEST", state: "VERIFIED" } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true, verifiedAt: true },
    }),
    prisma.automationRun.findFirst({
      where: { ruleKey: "backup", runKey: { startsWith: `backup:${businessDateKey(now)}` } },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { state: true },
    }),
    prisma.automationRun.findFirst({
      where: { ruleKey: "backup-manual" },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
      select: { startedAt: true },
    }),
  ]);
  const store = getBackupStore();
  const photoReadiness = await checkPrivateStoreReady();
  return {
    retentionDays: settings?.backupRetentionDays ?? BACKUP_RETENTION_RECOMMENDED_DAYS,
    destination: store?.source ?? "not set up",
    privatePhotos: photoReadiness,
    latestVerifiedAt: latestVerified?.verifiedAt ?? null,
    latestBytes: latestVerified?.sizeBytes ?? null,
    lastCompleteAt: completePair?.verifiedAt ?? null,
    allowManualRetry: (!lastManual || businessDateKey(lastManual.startedAt) !== businessDateKey(now)) &&
      (today?.state === "FAILED" || today?.state === "UNKNOWN"),
  };
}

export async function saveBackupRetentionDays(actorUserId: string, next: number, expected: number): Promise<void> {
  const value = validateBackupRetentionDays(next);
  await prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, actorUserId, ["OWNER"]);
    const locked = await tx.$queryRaw<Array<{ backupRetentionDays: number }>>`
      SELECT "backupRetentionDays" FROM "BusinessSettings" WHERE "id" = 'singleton' FOR UPDATE
    `;
    if (locked.length !== 1) throw new Error("Business settings are not set up yet.");
    if (locked[0]!.backupRetentionDays !== expected) throw new Error("This setting changed in another tab. Reload first.");
    if (next === expected) return;
    await tx.businessSettings.update({ where: { id: "singleton" }, data: { backupRetentionDays: value } });
    await tx.auditLog.create({ data: { userId: actorUserId, action: "backup.retention.update",
      entityType: "BusinessSettings", entityId: "singleton",
      oldValue: { backupRetentionDays: expected }, newValue: { backupRetentionDays: value },
    } });
  });
}
