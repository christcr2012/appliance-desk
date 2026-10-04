import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createApplianceUnits } from "@/domains/inventory";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

// Batch C P1-B: asset numbers come from a per-prefix counter that only moves forward (real Postgres).
// Each test uses its own prefix (A-Z only, up to 6 letters) so tests never share a counter.
describe.skipIf(!enabled)("asset numbers (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const userId = `asset-owner-${tag}`;
  const typeIds: string[] = [];
  const prefixes: string[] = [];

  // A type whose name gives exactly this prefix: a single word of 4 letters -> that word, upper-cased.
  async function typeFor(word: string) {
    const id = `asset-type-${word}-${tag}`;
    await prisma.applianceType.create({ data: { id, name: word, slug: `${word.toLowerCase()}-${tag}`, monthlyPriceCents: 1000 } });
    typeIds.push(id);
    prefixes.push(word.toUpperCase());
    return id;
  }
  const unit = (applianceTypeId: string, quantity = 1) => ({ applianceTypeId, quantity });

  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Owner", role: "OWNER" } });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.appliance.deleteMany({ where: { applianceTypeId: { in: typeIds } } });
    await prisma.applianceType.deleteMany({ where: { id: { in: typeIds } } });
    await prisma.assetNumberCounter.deleteMany({ where: { prefix: { in: prefixes } } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("asset-concurrent-creates-distinct: parallel creates never share a number", async () => {
    const typeId = await typeFor("AAQA");
    const batches = await Promise.all(Array.from({ length: 6 }, () => createApplianceUnits(userId, unit(typeId, 3))));
    const numbers = batches.flat().map((u) => u.assetNumber);
    expect(numbers).toHaveLength(18);
    expect(new Set(numbers).size).toBe(18);
    expect(numbers.sort()[0]).toBe("AAQA-0001");
    expect(numbers.sort()[17]).toBe("AAQA-0018");
  });

  it("asset-two-types-same-prefix-share-counter", async () => {
    const one = await typeFor("AABA"); // prefix AABA
    const id2 = `asset-type-b2-${tag}`;
    await prisma.applianceType.create({ data: { id: id2, name: "aaba", slug: `aaba2-${tag}`, monthlyPriceCents: 1000 } });
    typeIds.push(id2);
    const [a] = await createApplianceUnits(userId, unit(one));
    const [b] = await createApplianceUnits(userId, unit(id2));
    expect([a.assetNumber, b.assetNumber]).toEqual(["AABA-0001", "AABA-0002"]);
  });

  it("asset-missing-counter-seeded-from-nonstandard: padding and extra digits are read, other shapes ignored", async () => {
    const typeId = await typeFor("AACA");
    await prisma.appliance.create({ data: { assetNumber: "AACA-7", applianceTypeId: typeId } });
    await prisma.appliance.create({ data: { assetNumber: "AACA-0012", applianceTypeId: typeId } });
    await prisma.appliance.create({ data: { assetNumber: "aaca-0500", applianceTypeId: typeId } }); // wrong case: ignored
    await prisma.appliance.create({ data: { assetNumber: "AACA-USED", applianceTypeId: typeId } }); // not numeric: ignored
    const [u] = await createApplianceUnits(userId, unit(typeId));
    expect(u.assetNumber).toBe("AACA-0013");
  });

  it("asset-never-reuses-gap: a removed unit's number is not handed out again", async () => {
    const typeId = await typeFor("AADA");
    const made = await createApplianceUnits(userId, unit(typeId, 3));
    await prisma.auditLog.deleteMany({ where: { entityId: made[1].id } });
    await prisma.appliance.delete({ where: { id: made[1].id } });
    const [next] = await createApplianceUnits(userId, unit(typeId));
    expect(next.assetNumber).toBe("AADA-0004");
  });

  it("asset-hand-made-number-skipped: a number taken after the counter moved is skipped, not duplicated", async () => {
    const typeId = await typeFor("AAEA");
    await createApplianceUnits(userId, unit(typeId)); // counter now 2
    await prisma.appliance.create({ data: { assetNumber: "AAEA-0002", applianceTypeId: typeId } });
    await prisma.appliance.create({ data: { assetNumber: "AAEA-0003", applianceTypeId: typeId } });
    const made = await createApplianceUnits(userId, unit(typeId, 2));
    expect(made.map((u) => u.assetNumber)).toEqual(["AAEA-0004", "AAEA-0005"]);
  });

  it("asset-failure-midway-rolls-back-counter-and-units", async () => {
    const typeId = await typeFor("AAFA");
    await createApplianceUnits(userId, unit(typeId)); // AAFA-0001, counter 2
    // A temporary database rule makes the THIRD unit's insert fail, so units 2 and the counter move are already
    // written inside the transaction when it aborts: the whole call must leave nothing behind.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION asset_test_fail_${tag}() RETURNS trigger AS $$ BEGIN
      IF NEW."assetNumber" = 'AAFA-0004' THEN RAISE EXCEPTION 'boom'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER asset_test_fail BEFORE INSERT ON "Appliance" FOR EACH ROW EXECUTE FUNCTION asset_test_fail_${tag}()`);
    try {
      await expect(createApplianceUnits(userId, unit(typeId, 3))).rejects.toBeDefined();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER asset_test_fail ON "Appliance"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION asset_test_fail_${tag}()`);
    }
    expect(await prisma.appliance.count({ where: { applianceTypeId: typeId } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { userId, action: "appliance.unit.create", newValue: { path: ["applianceTypeId"], equals: typeId } } })).toBe(1);
    const counter = await prisma.assetNumberCounter.findUniqueOrThrow({ where: { prefix: "AAFA" } });
    expect(counter.nextSequence).toBe(2);
    const [after] = await createApplianceUnits(userId, unit(typeId));
    expect(after.assetNumber).toBe("AAFA-0002");
  });

  it("rejects a quantity outside 1-50", async () => {
    const typeId = await typeFor("AAGA");
    await expect(createApplianceUnits(userId, unit(typeId, 0))).rejects.toThrow(/between 1 and 50/);
    await expect(createApplianceUnits(userId, unit(typeId, 51))).rejects.toThrow(/between 1 and 50/);
  });
});
