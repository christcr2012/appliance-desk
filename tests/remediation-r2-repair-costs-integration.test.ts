import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { setJobRepairCosts } from "@/domains/jobs";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("R12 repair costs and the itemized-parts guard", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r12-owner-${tag}`;
  const jobIds: string[] = [];
  let partId = "";

  const newJob = async () => {
    const job = await prisma.job.create({ data: { type: "REMOVAL", status: "IN_PROGRESS" } });
    jobIds.push(job.id);
    return job.id;
  };

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: ownerId, email: `${tag}@example.test`, name: "R12", role: "OWNER", emailVerified: true },
    });
    partId = (
      await prisma.partRecord.create({
        data: { modelNumber: `R12-${tag}`, partNumber: `P-${tag}` },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: jobIds } } });
    // Part movements are append-only, so cleanup switches the rule off for its own rows, in one transaction.
    await prisma.$transaction([
      prisma.$executeRawUnsafe('ALTER TABLE "PartStockMovement" DISABLE TRIGGER "PartStockMovement_append_only"'),
      prisma.partStockMovement.deleteMany({ where: { partRecordId: partId } }),
      prisma.$executeRawUnsafe('ALTER TABLE "PartStockMovement" ENABLE TRIGGER "PartStockMovement_append_only"'),
    ]);
    await prisma.partRecord.deleteMany({ where: { id: partId } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.user.deleteMany({ where: { id: ownerId } });
  });

  it("saves valid whole-cent costs", async () => {
    const id = await newJob();
    await setJobRepairCosts(ownerId, id, { partsCostCents: 12345, laborCostCents: 5000 });
    const job = await prisma.job.findUniqueOrThrow({ where: { id } });
    expect([job.partsCostCents, job.laborCostCents]).toEqual([12345, 5000]);
  });

  it("a negative cost is refused and nothing is saved", async () => {
    const id = await newJob();
    await expect(
      setJobRepairCosts(ownerId, id, { partsCostCents: -1, laborCostCents: null }),
    ).rejects.toThrow(/Parts cost must be/);
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).partsCostCents).toBeNull();
  });

  it("a hand-entered parts cost is still refused when parts were itemized on the job", async () => {
    const id = await newJob();
    await prisma.partStockMovement.create({
      data: {
        partRecordId: partId,
        kind: "USAGE",
        quantityDelta: -1,
        balanceAfter: 0,
        operationKey: `r12-${tag}`,
        payloadHash: "x",
        jobId: id,
      },
    });
    await expect(
      setJobRepairCosts(ownerId, id, { partsCostCents: 1000, laborCostCents: 500 }),
    ).rejects.toThrow(/itemized/);
    // Clearing the parts cost to save labor still works.
    await setJobRepairCosts(ownerId, id, { partsCostCents: null, laborCostCents: 500 });
    expect((await prisma.job.findUniqueOrThrow({ where: { id } })).laborCostCents).toBe(500);
  });
});
