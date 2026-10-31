import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "ar6b-test", role: "OWNER" } })),
}));

import { prisma } from "@/lib/prisma";
import { countPurchases, listPurchases } from "@/domains/purchasing/purchases";

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

// AR-6b section 5: listPurchases is cursor-paged on the total order
// (purchasedOn desc, createdAt desc, id desc); search covers the linked
// supplier's name, the typed seller name and the receipt reference; rows
// carry the domain receipt total and the Tax question flag.
const MARK = "AR6BP";
const OWNER_ID = "8c1bea0e-b847-42a8-a6a9-cef8021420aa"; // seeded CI owner fixture
const DAY = new Date("2026-03-15T10:00:00.000Z");

let supplierId = "";
let typedId = "";
const ids: string[] = [];

async function purchase(data: {
  id: string;
  supplierId?: string;
  sellerName?: string;
  reference?: string;
  subtotalCents?: number;
  sellerTaxCents?: number;
  otherChargesCents?: number;
  purchasedOn?: Date;
  createdAt?: Date;
}) {
  ids.push(data.id);
  return prisma.purchase.create({
    data: {
      id: data.id,
      operationKey: `op-${data.id}`,
      payloadHash: "ar6b",
      supplierId: data.supplierId,
      sellerName: data.sellerName,
      reference: data.reference,
      purchasedOn: data.purchasedOn ?? DAY,
      subtotalCents: data.subtotalCents ?? 10000,
      sellerTaxCents: data.sellerTaxCents ?? 0,
      sellerTaxKind: "UNKNOWN",
      otherChargesCents: data.otherChargesCents ?? 0,
      createdByUserId: OWNER_ID,
      taxRevisionAt: new Date(),
      createdAt: data.createdAt,
    },
  });
}

describe.skipIf(!enabled)("AR-6b listPurchases (cursor)", () => {
  beforeAll(async () => {
    const supplier = await prisma.supplier.create({ data: { name: `${MARK} Supply Co` } });
    supplierId = supplier.id;
    // Three receipts on the same date AND the same createdAt instant —
    // the cursor must still walk each exactly once, newest id first.
    const same = new Date("2026-03-16T09:00:00.000Z");
    await purchase({ id: `${MARK}-a`, supplierId, reference: `${MARK}-REF-1`, createdAt: same });
    await purchase({ id: `${MARK}-b`, supplierId, reference: `${MARK}-REF-2`, createdAt: same });
    await purchase({ id: `${MARK}-c`, supplierId, subtotalCents: 5000, sellerTaxCents: 300, otherChargesCents: 200, createdAt: same });
    // A typed-seller receipt on an older day.
    const typed = await purchase({
      id: `${MARK}-typed`,
      sellerName: `${MARK} Yard Sale`,
      purchasedOn: new Date("2026-03-10T10:00:00.000Z"),
    });
    typedId = typed.id;
    // One appliance with an unanswered tax question on receipt b.
    const type = await prisma.applianceType.findFirstOrThrow();
    await prisma.appliance.create({
      data: {
        assetNumber: `${MARK}-UNIT-1`,
        applianceTypeId: type.id,
        purchaseId: `${MARK}-b`,
        status: "AVAILABLE",
      },
    });
  });

  afterAll(async () => {
    await prisma.appliance.deleteMany({ where: { purchaseId: { in: ids } } });
    await prisma.purchase.deleteMany({ where: { id: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { id: supplierId } });
  });

  it("walks same-instant receipts once each, in id-desc order within the instant", async () => {
    const seen: string[] = [];
    let cursor: { purchasedOn: string; createdAt: string; id: string } | undefined;
    for (let pageNo = 0; pageNo < 5; pageNo++) {
      const { rows, nextCursor } = await listPurchases({ supplierId, take: 1, cursor });
      seen.push(...rows.map((r) => r.id));
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    expect(seen).toEqual([`${MARK}-c`, `${MARK}-b`, `${MARK}-a`]);
  });

  it("carries the domain receipt total and the Tax question flag", async () => {
    const { rows } = await listPurchases({ supplierId });
    const c = rows.find((r) => r.id === `${MARK}-c`)!;
    expect(c.receiptTotalCents).toBe(5500);
    const b = rows.find((r) => r.id === `${MARK}-b`)!;
    expect(b.hasTaxQuestion).toBe(true);
    expect(rows.find((r) => r.id === `${MARK}-a`)!.hasTaxQuestion).toBe(false);
  });

  it("search matches supplier name, typed seller name and receipt reference", async () => {
    expect((await listPurchases({ q: `${MARK} Supply` })).rows.map((r) => r.id).sort())
      .toEqual([`${MARK}-a`, `${MARK}-b`, `${MARK}-c`]);
    expect((await listPurchases({ q: "Yard Sale" })).rows.map((r) => r.id)).toEqual([typedId]);
    expect((await listPurchases({ q: `${MARK}-REF-2` })).rows.map((r) => r.id)).toEqual([`${MARK}-b`]);
    expect(await countPurchases({ q: `${MARK} Supply` })).toBe(3);
  });
});
