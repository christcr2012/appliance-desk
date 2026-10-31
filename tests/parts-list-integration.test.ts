import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { getPartsList } from "@/domains/purchasing/parts-list";

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

// AR-6 fix 2 / spec section 6: the parts list is role-shaped at the DTO —
// staff rows do not carry the money keys at all — and the low-stock rule
// (threshold set AND on hand at or below it) is computed in the query so
// the low tab pages like any other.
const PREFIX = "AR6P-";

describe.skipIf(!enabled)("getPartsList", () => {
  beforeAll(async () => {
    await prisma.partRecord.deleteMany({ where: { modelNumber: { startsWith: PREFIX } } });
    await prisma.partRecord.createMany({
      data: [
        // Healthy stock, sellable, with money fields set.
        { modelNumber: `${PREFIX}A`, partNumber: "P-A", partName: "Drain pump", quantityOnHand: 5, reorderThreshold: 2, sellable: true, retailPriceCents: 1299, resaleUnitsOnHand: 2, resaleCostOnHandCents: 800 },
        // Low: 1 on hand, threshold 3.
        { modelNumber: `${PREFIX}B`, partNumber: "P-B", partName: "Belt", quantityOnHand: 1, reorderThreshold: 3 },
        // Archived, no threshold — only on the archived tab.
        { modelNumber: `${PREFIX}C`, partNumber: "P-C", partName: "Agitator", quantityOnHand: 0, reorderThreshold: null, archivedAt: new Date() },
        // Boundary: on hand exactly at threshold counts as low.
        { modelNumber: `${PREFIX}D`, partNumber: "P-D", partName: "Heating element", quantityOnHand: 2, reorderThreshold: 2 },
      ],
    });
  });

  afterAll(async () => {
    await prisma.partRecord.deleteMany({ where: { modelNumber: { startsWith: PREFIX } } });
  });

  it("owner rows carry the money fields and the right low-stock flags", async () => {
    const { rows } = await getPartsList({ q: PREFIX }, { role: "OWNER" });
    expect(rows.map((r) => r.modelNumber)).toEqual([`${PREFIX}A`, `${PREFIX}B`, `${PREFIX}D`]);
    const a = rows[0];
    expect(a.retailPriceCents).toBe(1299);
    expect(a.resaleUnitsOnHand).toBe(2);
    expect(a.resaleCostOnHandCents).toBe(800);
    expect(rows.map((r) => r.lowStock)).toEqual([false, true, true]);
  });

  it("staff rows have NO price/cost keys at all", async () => {
    const { rows } = await getPartsList({ q: PREFIX }, { role: "STAFF" });
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row).not.toHaveProperty("retailPriceCents");
      expect(row).not.toHaveProperty("resaleCostOnHandCents");
      expect(row).not.toHaveProperty("resaleUnitsOnHand");
      // Stock and the low-stock flag are operational — staff keep them.
      expect(typeof row.quantityOnHand).toBe("number");
      expect(typeof row.lowStock).toBe("boolean");
    }
  });

  it("the low tab returns only low parts; the archived tab only archived", async () => {
    const low = await getPartsList({ status: "low", q: PREFIX }, { role: "STAFF" });
    expect(low.rows.map((r) => r.modelNumber)).toEqual([`${PREFIX}B`, `${PREFIX}D`]);
    const archived = await getPartsList({ status: "archived", q: PREFIX }, { role: "OWNER" });
    expect(archived.rows.map((r) => r.modelNumber)).toEqual([`${PREFIX}C`]);
    expect(archived.rows[0].archived).toBe(true);
  });

  it("cursor paging walks every in-stock part exactly once", async () => {
    const seen: string[] = [];
    let cursor: { modelNumber: string; id: string } | undefined;
    for (let page = 0; page < 5; page++) {
      const result = await getPartsList({ q: PREFIX, take: 1, cursor }, { role: "OWNER" });
      seen.push(...result.rows.map((r) => r.modelNumber));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    expect(seen).toEqual([`${PREFIX}A`, `${PREFIX}B`, `${PREFIX}D`]);
  });

  it("refuses a customer actor", async () => {
    await expect(getPartsList({}, { role: "CUSTOMER" })).rejects.toThrow(/Only the team/);
  });
});
