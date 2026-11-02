import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPartsList, getPartsTypeOptions } from "@/domains/purchasing/parts-list";

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

// AR-6b section 6: the Parts page's reads over AR-6's getPartsList — the
// finance extras the rebuilt page and record header consume (average
// resale cost, the resale pre-tick), and the Type filter options. The
// role-shaping itself is proven in tests/parts-list-integration.test.ts.
const PREFIX = "AR6BP-";

describe.skipIf(!enabled)("AR-6b parts page reads", () => {
  beforeAll(async () => {
    await prisma.partRecord.deleteMany({ where: { modelNumber: { startsWith: PREFIX } } });
    await prisma.partRecord.createMany({
      data: [
        // Resale stock on hand: 3 units costing 1000 total → average 333.
        { modelNumber: `${PREFIX}A`, partNumber: "P-A", quantityOnHand: 4, resaleUnitsOnHand: 3, resaleCostOnHandCents: 1000, defaultForResale: true },
        // No resale units: the average is null, not zero.
        { modelNumber: `${PREFIX}B`, partNumber: "P-B", quantityOnHand: 2, resaleUnitsOnHand: 0, resaleCostOnHandCents: 0 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.partRecord.deleteMany({ where: { modelNumber: { startsWith: PREFIX } } });
  });

  it("finance rows carry the average resale cost and the resale pre-tick", async () => {
    const { rows } = await getPartsList({ q: PREFIX }, { role: "ADMIN" });
    const a = rows.find((r) => r.modelNumber === `${PREFIX}A`)!;
    expect(a.averageResaleCostCents).toBe(333);
    expect(a.defaultForResale).toBe(true);
    const b = rows.find((r) => r.modelNumber === `${PREFIX}B`)!;
    expect(b.averageResaleCostCents).toBeNull();
    expect(b.defaultForResale).toBe(false);
  });

  it("staff rows carry none of the AR-6b finance extras either", async () => {
    const { rows } = await getPartsList({ q: PREFIX }, { role: "STAFF" });
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("averageResaleCostCents");
      expect(row).not.toHaveProperty("defaultForResale");
    }
  });

  it("type options list the active types and refuse non-team actors", async () => {
    const options = await getPartsTypeOptions({ role: "STAFF" });
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]).toHaveProperty("id");
    expect(options[0]).toHaveProperty("name");
    await expect(getPartsTypeOptions({ role: "CUSTOMER" as never })).rejects.toThrow(/team/);
  });
});
