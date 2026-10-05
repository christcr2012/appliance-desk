import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/session";

const PAGE_SIZE = 25;

function pageNumber(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? Math.min(value, 500) : 1;
}

export async function getPartMovementHistory(partRecordId: string, requestedPage = 1) {
  await requireRole("OWNER", "ADMIN", "STAFF");
  const page = pageNumber(requestedPage);
  const part = await prisma.partRecord.findUnique({
    where: { id: partRecordId },
    select: {
      id: true,
      modelNumber: true,
      manufacturer: true,
      partNumber: true,
      partName: true,
      quantityOnHand: true,
      archivedAt: true,
      applianceType: { select: { name: true } },
    },
  });
  if (!part) return null;

  const rows = await prisma.partStockMovement.findMany({
    where: { partRecordId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      kind: true,
      quantityDelta: true,
      balanceAfter: true,
      reason: true,
      createdByUserId: true,
      createdAt: true,
      job: { select: { id: true, type: true } },
      purchaseOrderLineItem: {
        select: {
          description: true,
          purchaseOrder: { select: { id: true, status: true } },
        },
      },
    },
  });
  const hasMore = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);
  const actorIds = [...new Set(visible.map((row) => row.createdByUserId).filter((id): id is string => Boolean(id)))];
  const actors = actorIds.length > 0
    ? await prisma.user.findMany({
        where: { id: { in: actorIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const actorById = new Map(actors.map((actor) => [actor.id, actor]));

  return {
    part,
    page,
    pageSize: PAGE_SIZE,
    hasMore,
    movements: visible.map((row) => {
      const actor = row.createdByUserId ? actorById.get(row.createdByUserId) : undefined;
      return {
        ...row,
        actorLabel: actor?.name?.trim() || actor?.email || "System",
      };
    }),
  };
}
