import { prisma } from "@/lib/prisma";
import { assertActiveTeamActor } from "@/lib/team-actor";
import { checklistHash } from "./guided-actions";

function normalizeItems(items: string[]): string[] {
  const normalized = items.map((item) => item.trim());

  if (normalized.length < 1 || normalized.length > 40) {
    throw new Error("The inspection checklist must have between 1 and 40 items.");
  }
  if (normalized.some((item) => item.length < 2 || item.length > 200)) {
    throw new Error("Each inspection checklist item must be between 2 and 200 characters.");
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Inspection checklist items must be unique.");
  }

  return normalized;
}

export async function publishChecklistVersion(
  userId: string,
  items: string[],
): Promise<{ versionId: string; version: number }> {
  const normalized = normalizeItems(items);

  return prisma.$transaction(async (tx) => {
    await assertActiveTeamActor(tx, userId, ["OWNER", "ADMIN"]);

    // Batch C seeds version 1, so there is always a newest row to lock.
    await tx.$queryRaw`SELECT "id" FROM "InspectionChecklistVersion" ORDER BY "version" DESC LIMIT 1 FOR UPDATE`;
    const current = await tx.inspectionChecklistVersion.findFirst({
      orderBy: { version: "desc" },
      select: { version: true },
    });
    if (!current) {
      throw new Error("The inspection checklist has not been initialized.");
    }

    const version = current.version + 1;
    const created = await tx.inspectionChecklistVersion.create({
      data: {
        version,
        items: normalized,
        hash: checklistHash(normalized),
        publishedByUserId: userId,
      },
      select: { id: true },
    });

    await tx.auditLog.create({
      data: {
        userId,
        action: "inspection.checklist.published",
        entityType: "InspectionChecklistVersion",
        entityId: created.id,
        newValue: { version, itemCount: normalized.length },
      },
    });

    return { versionId: created.id, version };
  });
}

export async function listChecklistVersions() {
  return prisma.inspectionChecklistVersion.findMany({
    orderBy: { version: "desc" },
    select: {
      id: true,
      version: true,
      items: true,
      hash: true,
      publishedAt: true,
      publishedByUserId: true,
    },
  });
}
