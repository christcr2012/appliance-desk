import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { bulkUpdateApplianceStatus, updateApplianceStatus } from "@/domains/inventory";
import { retireAppliance } from "@/domains/inventory/guided-actions";

// Disposable CI Postgres only (same gate as the other integration tests).
const url = (() => {
  try {
    return new URL(process.env.DATABASE_URL ?? "");
  } catch {
    return null;
  }
})();
const enabled =
  process.env.CI === "true" &&
  url !== null &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

// AR-6 fix 3 (spec EQUIPMENT section 1): the plain status change and the
// bulk change can no longer set RETIRED — retiring goes through
// retireAppliance so the reason (and the retired plan) is kept.
const RETIRE_MESSAGE = "Use Retire this appliance so the reason is kept.";

describe.skipIf(!enabled)("AR-6 fix 3: RETIRED refused by the plain and bulk status changes", () => {
  let ownerId = "";
  let typeId = "";
  const createdIds: string[] = [];

  async function unit(assetNumber: string) {
    const appliance = await prisma.appliance.create({
      data: { assetNumber, applianceTypeId: typeId, status: "AVAILABLE" },
    });
    createdIds.push(appliance.id);
    return appliance.id;
  }

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    const type = await prisma.applianceType.create({
      data: { name: "AR6 Guard Washer", slug: `ar6-guard-${Date.now()}` },
    });
    typeId = type.id;
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: createdIds } } });
    await prisma.appliance.deleteMany({ where: { id: { in: createdIds } } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
  });

  it("the plain status change refuses RETIRED and changes nothing", async () => {
    const id = await unit("AR6-GUARD-1");
    await expect(updateApplianceStatus(ownerId, id, "RETIRED")).rejects.toThrow(RETIRE_MESSAGE);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("AVAILABLE");
  });

  it("the bulk change skips RETIRED with the reason and changes nothing", async () => {
    const id = await unit("AR6-GUARD-2");
    const result = await bulkUpdateApplianceStatus(ownerId, [id], "RETIRED");
    expect(result.updated).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain(RETIRE_MESSAGE);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("AVAILABLE");
  });

  it("other plain changes still work, and retireAppliance still retires with its reason", async () => {
    const id = await unit("AR6-GUARD-3");
    await updateApplianceStatus(ownerId, id, "MAINTENANCE");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id } })).status).toBe("MAINTENANCE");

    await expect(retireAppliance(ownerId, id, "  ")).rejects.toThrow(/reason is required/);
    await retireAppliance(ownerId, id, "Motor burned out.");
    const retired = await prisma.appliance.findUniqueOrThrow({ where: { id } });
    expect(retired.status).toBe("RETIRED");
    expect(retired.notes).toContain("Retired: Motor burned out.");
  });
});
