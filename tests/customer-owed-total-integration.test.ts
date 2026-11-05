import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";

// PB-FIX-1: the Invoice_maintain_customer_owed database trigger keeps
// Customer.owedCents equal to the live aggregate the customers list used
// to compute per call — SUM(GREATEST(0, due - paid)) over the customer's
// invoices in ('OPEN','PARTIALLY_PAID','DELINQUENT','FAILED'). Every case
// asserts stored == live after the write settles, including the writers
// that bypass Prisma (raw SQL) and concurrent writers on one customer.
// The ordering parity case proves the owed-desc id order from the stored
// column is byte-identical to the order from the live aggregate it
// replaced. Runs only against the local throwaway test DB.
const ready = (() => {
  try {
    const url = new URL(process.env.DATABASE_URL ?? "");
    return (
      process.env.CI === "true" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1") &&
      url.pathname === "/appliance_desk_test"
    );
  } catch {
    return false;
  }
})();

const tag = `owt-${Date.now().toString(36)}`;
const customerIds: string[] = [];
const userIds: string[] = [];

async function makeCustomer(name: string): Promise<string> {
  const email = `${tag}-${name.replace(/\W+/g, "").toLowerCase()}@example.test`;
  const user = await prisma.user.create({ data: { name: `${tag} ${name}`, email, role: "CUSTOMER" } });
  userIds.push(user.id);
  const customer = await prisma.customer.create({
    data: { userId: user.id, referralCode: `REF-${email}` },
  });
  customerIds.push(customer.id);
  return customer.id;
}

async function liveOwed(customerId: string): Promise<number> {
  const rows = await prisma.$queryRaw<{ owed: number }[]>`
    SELECT COALESCE(SUM(GREATEST(0, "amountDueCents" - "amountPaidCents")), 0)::int AS owed
    FROM "Invoice"
    WHERE "customerId" = ${customerId}
      AND "status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')`;
  return rows[0].owed;
}

async function storedOwed(customerId: string): Promise<number> {
  // Raw SQL on purpose: this test judges the database (column + trigger),
  // not the generated client, so it stays valid against any client vintage.
  const rows = await prisma.$queryRaw<{ owed: number }[]>`
    SELECT "owedCents" AS owed FROM "Customer" WHERE "id" = ${customerId}`;
  return rows[0].owed;
}

async function expectSynced(customerId: string) {
  expect(await storedOwed(customerId)).toBe(await liveOwed(customerId));
}

describe.skipIf(!ready)("PB-FIX-1 maintained Customer.owedCents (integration)", () => {
  afterAll(async () => {
    await prisma.invoice.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("tracks inserts, payments, status flips, no-money updates, raw SQL, delete", async () => {
    const a = await makeCustomer("Alpha");
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(0);

    const inv1 = await prisma.invoice.create({
      data: { customerId: a, status: "OPEN", amountDueCents: 10_000, amountPaidCents: 0 },
    });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(10_000);

    const inv2 = await prisma.invoice.create({
      data: { customerId: a, status: "PARTIALLY_PAID", amountDueCents: 5_000, amountPaidCents: 1_500 },
    });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(13_500);

    // A DRAFT invoice is outside the open set: no movement.
    await prisma.invoice.create({
      data: { customerId: a, status: "DRAFT", amountDueCents: 99_999, amountPaidCents: 0 },
    });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(13_500);

    // Overpayment floors this invoice's contribution at zero.
    await prisma.invoice.update({
      where: { id: inv2.id },
      data: { amountPaidCents: 6_000 },
    });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(10_000);

    // Partial payment.
    await prisma.invoice.update({ where: { id: inv1.id }, data: { amountPaidCents: 4_000 } });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(6_000);

    // Status flip out of the open set removes the remainder...
    await prisma.invoice.update({ where: { id: inv1.id }, data: { status: "PAID" } });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(0);

    // ...and flipping back restores it.
    await prisma.invoice.update({ where: { id: inv1.id }, data: { status: "DELINQUENT" } });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(6_000);

    // An update that changes no money field leaves the total alone.
    await prisma.invoice.update({
      where: { id: inv1.id },
      data: { dueDate: new Date("2027-01-15T00:00:00Z") },
    });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(6_000);

    // A writer that bypasses Prisma entirely is still maintained.
    await prisma.$executeRaw`
      INSERT INTO "Invoice" ("id", "customerId", "status", "amountDueCents", "amountPaidCents", "createdAt", "updatedAt")
      VALUES (${`${tag}-raw`}, ${a}, 'FAILED', 2500, 500, NOW(), NOW())`;
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(8_000);

    // Delete removes the contribution.
    await prisma.invoice.delete({ where: { id: inv1.id } });
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(2_000);
  });

  it("moves the contribution when an invoice is reassigned to another customer", async () => {
    const a = await makeCustomer("Bravo");
    const b = await makeCustomer("Charlie");
    const inv = await prisma.invoice.create({
      data: { customerId: a, status: "OPEN", amountDueCents: 7_000, amountPaidCents: 1_000 },
    });
    await expectSynced(a);
    await prisma.invoice.update({ where: { id: inv.id }, data: { customerId: b } });
    await expectSynced(a);
    await expectSynced(b);
    expect(await storedOwed(a)).toBe(0);
    expect(await storedOwed(b)).toBe(6_000);
  });

  it("stays exact under concurrent writers on the same customer", async () => {
    const a = await makeCustomer("Delta");
    await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        prisma.invoice.create({
          data: { customerId: a, status: "OPEN", amountDueCents: 1_000 * (i + 1), amountPaidCents: 0 },
        }),
      ),
    );
    await expectSynced(a);
    expect(await storedOwed(a)).toBe(21_000);
  });

  it("orders owed-desc identically from the column and from the live aggregate", async () => {
    // A tie and a zero among the fixtures, on top of whatever the seed
    // population already holds: both orderings run over the whole table.
    const hi = await makeCustomer("Echo");
    const tieA = await makeCustomer("Foxtrot");
    const tieB = await makeCustomer("Golf");
    await makeCustomer("Hotel");
    for (const [cid, due] of [[hi, 9_000], [tieA, 5_000], [tieB, 5_000]] as const) {
      await prisma.invoice.create({
        data: { customerId: cid, status: "OPEN", amountDueCents: due, amountPaidCents: 0 },
      });
    }
    for (const cid of customerIds) await expectSynced(cid);

    const byColumn = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Customer" c JOIN "User" u ON u."id" = c."userId"
      WHERE c."archivedAt" IS NULL AND NOT c."isWalkIn"
      ORDER BY c."owedCents" DESC, lower(COALESCE(c."companyName", u."name", u."email")) ASC, c."id" ASC`;
    const byAggregate = await prisma.$queryRaw<{ id: string }[]>`
      SELECT c."id" FROM "Customer" c JOIN "User" u ON u."id" = c."userId"
      LEFT JOIN (
        SELECT inv."customerId" AS "cid",
          COALESCE(SUM(GREATEST(0, inv."amountDueCents" - inv."amountPaidCents")), 0)::int AS "owedCents"
        FROM "Invoice" inv
        WHERE inv."status" IN ('OPEN', 'PARTIALLY_PAID', 'DELINQUENT', 'FAILED')
        GROUP BY inv."customerId"
      ) i ON i."cid" = c."id"
      WHERE c."archivedAt" IS NULL AND NOT c."isWalkIn"
      ORDER BY COALESCE(i."owedCents", 0) DESC, lower(COALESCE(c."companyName", u."name", u."email")) ASC, c."id" ASC`;
    expect(byColumn.map((r) => r.id)).toEqual(byAggregate.map((r) => r.id));
  });
});
