import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

// During a deploy the old version of the app can still save the old
// tenths-of-a-percent column. These prove the new exact column follows it (and
// the reverse), so tax is never silently left at zero.
describe.skipIf(!enabled)("old and new tax-rate columns stay in step", () => {
  const tag = randomUUID().replaceAll("-", "").slice(0, 16);
  const userId = `tax-sync-user-${tag}`;
  const customerId = `tax-sync-cust-${tag}`;
  const addressId = `tax-sync-addr-${tag}`;
  let originalSettings = { taxRatePermille: 0, taxRateMilliPercent: 0 };
  const agreementIds: string[] = [];

  async function newAgreement(taxes: { taxRatePermille?: number; taxRateMilliPercent?: number }) {
    const id = `tax-sync-agr-${tag}-${agreementIds.length}`;
    agreementIds.push(id);
    await prisma.rentalAgreement.create({
      data: { id, customerId, serviceAddressId: addressId, status: "DRAFT", ...taxes },
    });
    return id;
  }
  const read = (id: string) =>
    prisma.rentalAgreement.findUniqueOrThrow({
      where: { id },
      select: { taxRatePermille: true, taxRateMilliPercent: true },
    });

  beforeAll(async () => {
    const s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    originalSettings = { taxRatePermille: s.taxRatePermille, taxRateMilliPercent: s.taxRateMilliPercent };
    await prisma.user.create({
      data: { id: userId, email: `${tag}@example.test`, name: "Tax Sync", role: "CUSTOMER", emailVerified: true },
    });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: `T${tag}` } });
    await prisma.serviceAddress.create({
      data: { id: addressId, customerId, line1: "1 Test St", city: "Greeley", zip: "80631" },
    });
  });

  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: originalSettings });
    await prisma.rentalAgreement.deleteMany({ where: { id: { in: agreementIds } } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("an old-version save of an agreement (old column only) updates the exact column", async () => {
    const id = await newAgreement({ taxRatePermille: 73 });
    expect(await read(id)).toEqual({ taxRatePermille: 73, taxRateMilliPercent: 7300 });
    await prisma.rentalAgreement.update({ where: { id }, data: { taxRatePermille: 80 } });
    expect(await read(id)).toEqual({ taxRatePermille: 80, taxRateMilliPercent: 8000 });
  });

  it("a new-version save (exact column only) keeps the old column roughly right for a rollback", async () => {
    const id = await newAgreement({ taxRateMilliPercent: 7375 });
    expect(await read(id)).toEqual({ taxRatePermille: 74, taxRateMilliPercent: 7375 });
    await prisma.rentalAgreement.update({ where: { id }, data: { taxRateMilliPercent: 8250 } });
    expect(await read(id)).toEqual({ taxRatePermille: 83, taxRateMilliPercent: 8250 });
  });

  it("never overwrites an exact value when the new version saves both columns", async () => {
    const id = await newAgreement({ taxRatePermille: 74, taxRateMilliPercent: 7375 });
    expect(await read(id)).toEqual({ taxRatePermille: 74, taxRateMilliPercent: 7375 });
    // An unrelated save leaves both alone.
    await prisma.rentalAgreement.update({ where: { id }, data: { termMonths: 12 } });
    expect(await read(id)).toEqual({ taxRatePermille: 74, taxRateMilliPercent: 7375 });
  });

  it("the owner's business-wide rate follows the same rule in both directions", async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { taxRatePermille: 77 } });
    let s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect(s.taxRateMilliPercent).toBe(7700);
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { taxRateMilliPercent: 7375 } });
    s = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
    expect([s.taxRatePermille, s.taxRateMilliPercent]).toEqual([74, 7375]);
  });
});
