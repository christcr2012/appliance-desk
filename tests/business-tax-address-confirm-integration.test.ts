import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { confirmBusinessTaxAddress } from "@/domains/tax/locations";

const u = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(u.hostname)
  && u.pathname === "/appliance_desk_test";
const tag = randomUUID().slice(0, 14).replaceAll("-", "");
const owner = "w0a-owner-" + tag, staff = "w0a-staff-" + tag, area = "w0a-area-" + tag;
describe.skipIf(!enabled)("W-0A business tax-area confirmation (Postgres)", () => {
  let oldAddress: unknown;
  let oldLocationIds: string[] = [];
  beforeAll(async () => {
    oldAddress = (await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" }, select: { businessTaxAddress: true },
    })).businessTaxAddress;
    oldLocationIds = (await prisma.addressTaxLocation.findMany({
      where: { forBusinessLocation: true, isCurrent: true }, select: { id: true },
    })).map(x => x.id);
    await prisma.addressTaxLocation.updateMany({
      where: { id: { in: oldLocationIds } }, data: { isCurrent: false },
    });
    await prisma.user.createMany({ data: [
      { id: owner, email: tag + "-owner@example.test", role: "OWNER" },
      { id: staff, email: tag + "-staff@example.test", role: "STAFF" },
    ] });
    await prisma.taxJurisdiction.create({
      data: { id: area, code: "W0A-" + tag, name: "Greeley test",
        level: "CITY", administration: "SELF_COLLECTED" },
    });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { businessTaxAddress: { line1: "1 Test Way", city: "Greeley", state: "CO", zip: "80631" } } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: owner, action: "tax.business_address.confirm" } });
    await prisma.addressTaxLocation.deleteMany({
      where: { forBusinessLocation: true, confirmedByUserId: owner },
    });
    await prisma.addressTaxLocation.updateMany({
      where: { id: { in: oldLocationIds } }, data: { isCurrent: true },
    });
    await prisma.businessSettings.update({ where: { id: "singleton" },
      data: { businessTaxAddress: oldAddress as never } });
    await prisma.taxJurisdiction.delete({ where: { id: area } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, staff] } } });
  });
  it("owner confirms business tax areas with audit evidence", async () => {
    await confirmBusinessTaxAddress(owner, { jurisdictionIds: [area] });
    const location = await prisma.addressTaxLocation.findFirstOrThrow({
      where: { forBusinessLocation: true, isCurrent: true },
      include: { jurisdictions: true },
    });
    expect(location).toMatchObject({ status: "VERIFIED", source: "MANUAL", confirmedByUserId: owner });
    expect(location.jurisdictions.map(j => j.jurisdictionId)).toEqual([area]);
    expect(await prisma.auditLog.count({
      where: { userId: owner, action: "tax.business_address.confirm" },
    })).toBe(1);
  });
  it("staff cannot confirm", async () => {
    await expect(confirmBusinessTaxAddress(staff, { jurisdictionIds: [area] })).rejects.toThrow();
  });
  it("unknown jurisdiction is rejected", async () => {
    await expect(confirmBusinessTaxAddress(owner, { jurisdictionIds: ["not-real-" + tag] }))
      .rejects.toThrow(/no longer exist/);
  });
});
