import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { recordPartUsage } from "@/domains/purchasing";
import { lockPartRecords } from "@/domains/purchasing/ledger";
import { prisma } from "@/lib/prisma";

// Part movements are append-only, so (like the other purchasing tests) these tagged fixtures are
// left behind in the throwaway test database.
const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("R15 usage cost is read after the part lock", () => {
  const tag = randomUUID();
  let ownerId = "";
  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
  });

  const part = async (quantityOnHand: number) =>
    (await prisma.partRecord.create({ data: { modelNumber: `${tag}-${randomUUID()}`, partNumber: tag, quantityOnHand } })).id;

  /** A receipt in progress: holds the part lock, lets a usage start and queue behind it, then commits. */
  async function receiptWhileUsageWaits(partId: string, receiptCostCents: number) {
    let usage: Promise<unknown> = Promise.resolve();
    await prisma.$transaction(async (tx) => {
      await lockPartRecords(tx, [partId]);
      usage = recordPartUsage(ownerId, partId, 1, { operationKey: `use-${randomUUID()}` });
      usage.catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 400)); // the usage is now waiting on the lock
      await tx.partStockMovement.create({
        data: {
          partRecordId: partId, kind: "RECEIPT", quantityDelta: 5, balanceAfter: 5,
          unitCostCents: receiptCostCents, operationKey: `receipt-${randomUUID()}`, payloadHash: "r15",
          createdAt: new Date(),
        },
      });
      await tx.partRecord.update({ where: { id: partId }, data: { quantityOnHand: 5 } });
    });
    await usage;
  }

  it("a receipt that commits first is the cost the usage records", async () => {
    const partId = await part(0);
    await receiptWhileUsageWaits(partId, 725);
    const usage = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: partId, kind: "USAGE" } });
    expect(usage.unitCostCents).toBe(725);
    expect(usage.balanceAfter).toBe(4);
  });

  it("a usage that wins first honestly uses the earlier cost", async () => {
    const partId = await part(0);
    await prisma.partStockMovement.create({
      data: {
        partRecordId: partId, kind: "RECEIPT", quantityDelta: 3, balanceAfter: 3, unitCostCents: 400,
        operationKey: `seed-${randomUUID()}`, payloadHash: "r15-seed", createdAt: new Date(Date.now() - 60_000),
      },
    });
    await prisma.partRecord.update({ where: { id: partId }, data: { quantityOnHand: 3 } });

    await recordPartUsage(ownerId, partId, 1, { operationKey: `use-${randomUUID()}` });

    const usage = await prisma.partStockMovement.findFirstOrThrow({ where: { partRecordId: partId, kind: "USAGE" } });
    expect(usage.unitCostCents).toBe(400);
  });
});
