import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "ar6b-test", role: "OWNER" } })),
}));

import { prisma } from "@/lib/prisma";
import { getSuppliersPage } from "@/domains/purchasing/suppliers-page";

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

// AR-6b section 7: the suppliers list read — cursor on (name asc, id asc),
// active by default, search over name and contact person, and the
// "{n} orders" count = purchase orders + appliance purchases.
const MARK = "AR6BS";
const OWNER_ID = "8c1bea0e-b847-42a8-a6a9-cef8021420aa"; // seeded CI owner fixture
const ids: string[] = [];

async function supplier(data: { name: string; contactName?: string; phone?: string; archived?: boolean }) {
  const row = await prisma.supplier.create({
    data: {
      name: data.name,
      contactName: data.contactName,
      phone: data.phone,
      archivedAt: data.archived ? new Date() : null,
    },
  });
  ids.push(row.id);
  return row;
}

describe.skipIf(!enabled)("AR-6b getSuppliersPage", () => {
  beforeAll(async () => {
    const alpha = await supplier({ name: `${MARK} Alpha`, contactName: "Ann Alpha", phone: "970-555-0101" });
    await supplier({ name: `${MARK} Beta`, contactName: "Bob Beta" });
    await supplier({ name: `${MARK} Old`, archived: true });
    // Alpha: two purchase orders + one appliance purchase = 3 orders.
    await prisma.purchaseOrder.createMany({
      data: [
        { supplierId: alpha.id, status: "DRAFT", createdByUserId: OWNER_ID },
        { supplierId: alpha.id, status: "ORDERED", createdByUserId: OWNER_ID },
      ],
    });
    await prisma.purchase.create({
      data: {
        operationKey: `op-${MARK}-alpha`,
        payloadHash: "ar6b",
        supplierId: alpha.id,
        purchasedOn: new Date("2026-03-01T10:00:00.000Z"),
        subtotalCents: 1000,
        sellerTaxKind: "UNKNOWN",
        createdByUserId: OWNER_ID,
        taxRevisionAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.purchase.deleteMany({ where: { supplierId: { in: ids } } });
    await prisma.purchaseOrder.deleteMany({ where: { supplierId: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { id: { in: ids } } });
  });

  it("active list is name-ordered, archived excluded, with the combined order count", async () => {
    const { rows } = await getSuppliersPage({ q: MARK });
    expect(rows.map((r) => r.name)).toEqual([`${MARK} Alpha`, `${MARK} Beta`]);
    expect(rows[0]!.orderCount).toBe(3);
    expect(rows[0]!.phone).toBe("970-555-0101");
    expect(rows[1]!.orderCount).toBe(0);
  });

  it("the archived tab holds only archived suppliers", async () => {
    const { rows } = await getSuppliersPage({ status: "archived", q: MARK });
    expect(rows.map((r) => r.name)).toEqual([`${MARK} Old`]);
    expect(rows[0]!.archived).toBe(true);
  });

  it("search matches the contact person too, and the cursor walks the list once", async () => {
    // "Bob Beta" is unique to this suite's Beta; other suites' suppliers
    // share the bench database, so the walk below stays on the MARK names.
    expect((await getSuppliersPage({ q: "Bob Beta" })).rows.map((r) => r.name)).toEqual([`${MARK} Beta`]);
    const seen: string[] = [];
    let cursor: { name: string; id: string } | undefined;
    // take 1, walking by name: "AR6BS ..." sorts before other suites'
    // suppliers (e.g. "Ledger ..."), so the first two steps are ours.
    for (let pageNo = 0; pageNo < 2; pageNo++) {
      const { rows, nextCursor } = await getSuppliersPage({ take: 1, cursor });
      seen.push(...rows.map((r) => r.name));
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    expect(seen).toEqual([`${MARK} Alpha`, `${MARK} Beta`]);
  });
});
