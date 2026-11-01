import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  requireRole: vi.fn(async () => ({ user: { id: "ar6b-test", role: "OWNER" } })),
}));

import { prisma } from "@/lib/prisma";
import {
  PURCHASE_ORDER_PILL,
  getPurchaseOrdersPage,
} from "@/domains/purchasing/orders-page";

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

// AR-6b section 5 (spec section 9): the orders page read — status tabs
// (open = DRAFT + ORDERED), the supplier filter, cursor paging over
// same-instant orders, and the known total computed in the domain.
const MARK = "AR6BO";
let OWNER_ID = ""; // the seeded OWNER row's id — the seed generates it, so resolve it in beforeAll
let supplierId = "";
let otherSupplierId = "";
const ids: string[] = [];

async function order(data: {
  id: string;
  status: "DRAFT" | "ORDERED" | "RECEIVED" | "CANCELLED";
  supplier?: string;
  createdAt?: Date;
  receivedAt?: Date;
  lines?: { description: string; quantity: number; unitCostCents: number; unitCostKnown: boolean }[];
}) {
  ids.push(data.id);
  return prisma.purchaseOrder.create({
    data: {
      id: data.id,
      supplierId: data.supplier ?? supplierId,
      status: data.status,
      createdByUserId: OWNER_ID,
      createdAt: data.createdAt,
      receivedAt: data.receivedAt,
      lines: { create: data.lines ?? [] },
    },
  });
}

describe.skipIf(!enabled)("AR-6b getPurchaseOrdersPage", () => {
  beforeAll(async () => {
    OWNER_ID = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } })).id;
    supplierId = (await prisma.supplier.create({ data: { name: `${MARK} Parts` } })).id;
    otherSupplierId = (await prisma.supplier.create({ data: { name: `${MARK} Other` } })).id;
    const same = new Date("2026-03-16T09:00:00.000Z");
    // Two open orders in the same instant; the priced one mixes a known
    // and an unknown line price.
    await order({
      id: `${MARK}-o1`, status: "DRAFT", createdAt: same,
      lines: [
        { description: "Pump", quantity: 2, unitCostCents: 1500, unitCostKnown: true },
        { description: "Mystery hose", quantity: 1, unitCostCents: 0, unitCostKnown: false },
      ],
    });
    await order({ id: `${MARK}-o2`, status: "ORDERED", createdAt: same });
    await order({
      id: `${MARK}-o3`, status: "RECEIVED",
      receivedAt: new Date("2026-03-18T09:00:00.000Z"),
      lines: [{ description: "Belt", quantity: 3, unitCostCents: 700, unitCostKnown: true }],
    });
    await order({ id: `${MARK}-o4`, status: "CANCELLED" });
    await order({ id: `${MARK}-o5`, status: "DRAFT", supplier: otherSupplierId });
  });

  afterAll(async () => {
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: ids } } });
    await prisma.supplier.deleteMany({ where: { id: { in: [supplierId, otherSupplierId] } } });
  });

  it("the open tab holds drafts and placed orders, supplier-filtered, same-instant safe", async () => {
    const all = await getPurchaseOrdersPage({ supplierId });
    expect(all.rows.map((r) => r.id)).toEqual([`${MARK}-o2`, `${MARK}-o1`]);
    const seen: string[] = [];
    let cursor: { createdAt: string; id: string } | undefined;
    for (let pageNo = 0; pageNo < 4; pageNo++) {
      const { rows, nextCursor } = await getPurchaseOrdersPage({ supplierId, take: 1, cursor });
      seen.push(...rows.map((r) => r.id));
      if (!nextCursor) break;
      cursor = nextCursor;
    }
    expect(seen).toEqual([`${MARK}-o2`, `${MARK}-o1`]);
  });

  it("computes the known total and unpriced count in the domain", async () => {
    const { rows } = await getPurchaseOrdersPage({ supplierId });
    const o1 = rows.find((r) => r.id === `${MARK}-o1`)!;
    expect(o1.lineCount).toBe(2);
    expect(o1.knownTotalCents).toBe(3000);
    expect(o1.unpricedLines).toBe(1);
    expect(o1.supplierName).toBe(`${MARK} Parts`);
  });

  it("received and cancelled tabs hold only their own orders", async () => {
    // Scoped to this suite's supplier — the shared bench database holds
    // other suites' orders too.
    const received = await getPurchaseOrdersPage({ status: "received", supplierId });
    expect(received.rows.map((r) => r.id)).toEqual([`${MARK}-o3`]);
    expect(received.rows[0]!.receivedAt).not.toBeNull();
    const cancelled = await getPurchaseOrdersPage({ status: "cancelled", supplierId });
    expect(cancelled.rows.map((r) => r.id)).toEqual([`${MARK}-o4`]);
  });

  it("the pill words are the plain ones", () => {
    expect(PURCHASE_ORDER_PILL.DRAFT.label).toBe("Draft");
    expect(PURCHASE_ORDER_PILL.ORDERED.label).toBe("Ordered");
    expect(PURCHASE_ORDER_PILL.RECEIVED.label).toBe("Arrived");
    expect(PURCHASE_ORDER_PILL.CANCELLED.label).toBe("Cancelled");
  });
});
