import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { archiveSupplier, createPurchaseOrder } from "@/domains/purchasing";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("R14 purchase-order creation is one guarded transaction", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `r14-owner-${tag}`;
  const staffId = `r14-staff-${tag}`;
  const supplierIds: string[] = [];
  const triggers: string[] = [];

  const supplier = async () => {
    const row = await prisma.supplier.create({ data: { name: `R14 ${randomUUID()}` } });
    supplierIds.push(row.id);
    return row.id;
  };
  const orders = (supplierId: string) => prisma.purchaseOrder.count({ where: { supplierId } });
  const lines = [{ description: "Door seal", quantity: 2, unitCostCents: 500 }];

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `o-${tag}@example.test`, name: "R14 owner", role: "OWNER", emailVerified: true },
        { id: staffId, email: `s-${tag}@example.test`, name: "R14 staff", role: "STAFF", emailVerified: true },
      ],
    });
  });

  afterEach(async () => {
    for (const fn of triggers.splice(0)) {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${fn}" ON "AuditLog"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${fn}"()`);
    }
  });

  afterAll(async () => {
    const pos = await prisma.purchaseOrder.findMany({ where: { supplierId: { in: supplierIds } }, select: { id: true } });
    const poIds = pos.map((p) => p.id);
    await prisma.auditLog.deleteMany({
      where: { OR: [{ entityId: { in: [...poIds, ...supplierIds] } }, { userId: { in: [ownerId, staffId] } }] },
    });
    await prisma.purchaseOrderLineItem.deleteMany({ where: { purchaseOrderId: { in: poIds } } });
    await prisma.purchaseOrder.deleteMany({ where: { id: { in: poIds } } });
    await prisma.supplier.deleteMany({ where: { id: { in: supplierIds } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, staffId] } } });
  });

  it("creates the order and its audit entry together", async () => {
    const supplierId = await supplier();
    const order = await createPurchaseOrder(ownerId, { supplierId, lines });
    expect(await prisma.auditLog.count({ where: { entityId: order.id, action: "purchase_order.create" } })).toBe(1);
  });

  it("a staff member is refused and no order is created", async () => {
    const supplierId = await supplier();
    await expect(createPurchaseOrder(staffId, { supplierId, lines })).rejects.toThrow(/no longer has access/);
    expect(await orders(supplierId)).toBe(0);
  });

  it("an audit failure leaves no order behind", async () => {
    const supplierId = await supplier();
    const fn = `r14_fail_${tag}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION "${fn}"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'simulated audit failure'; END $$ LANGUAGE plpgsql`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER "${fn}" BEFORE INSERT ON "AuditLog" FOR EACH ROW WHEN (NEW."action" = 'purchase_order.create' AND NEW."userId" = '${ownerId}') EXECUTE FUNCTION "${fn}"()`,
    );
    triggers.push(fn);
    await expect(createPurchaseOrder(ownerId, { supplierId, lines })).rejects.toThrow();
    expect(await orders(supplierId)).toBe(0);
  });

  it("an archived or unknown supplier is refused", async () => {
    const supplierId = await supplier();
    await archiveSupplier(ownerId, supplierId);
    await expect(createPurchaseOrder(ownerId, { supplierId, lines })).rejects.toThrow(/archived/);
    await expect(createPurchaseOrder(ownerId, { supplierId: `missing-${tag}`, lines })).rejects.toThrow(/Choose a supplier/);
    expect(await orders(supplierId)).toBe(0);
  });

  it("archiving a supplier while an order is being created: never an order on an archived supplier that was archived first", async () => {
    // Repeat the race; whichever wins, the end state must be consistent: if the archive
    // committed first the order was refused, otherwise the order exists and the archive followed it.
    for (let i = 0; i < 8; i += 1) {
      const supplierId = await supplier();
      const [created, archived] = await Promise.allSettled([
        createPurchaseOrder(ownerId, { supplierId, lines }),
        archiveSupplier(ownerId, supplierId),
      ]);
      expect(archived.status).toBe("fulfilled");
      const row = await prisma.supplier.findUniqueOrThrow({ where: { id: supplierId } });
      expect(row.archivedAt).not.toBeNull();
      expect(await orders(supplierId)).toBe(created.status === "fulfilled" ? 1 : 0);
      if (created.status === "rejected") expect(String(created.reason)).toMatch(/archived/);
    }
  });
});
