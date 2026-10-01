import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/email", () => ({ sendEmail: vi.fn(async () => ({ sent: false })) }));
import { prisma } from "@/lib/prisma";
import { createMaintenanceRequestForUser, getPortalApplianceOptions, getPortalData } from "@/domains/portal";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("portal equipment eligibility in disposable Postgres", () => {
  const tag = randomUUID();
  const userId = `elig-user-${tag}`, customerId = `elig-customer-${tag}`, addressId = `elig-address-${tag}`;
  const agreementId = `elig-agreement-${tag}`, typeId = `elig-type-${tag}`, applianceId = `elig-unit-${tag}`;
  beforeAll(async () => {
    await prisma.user.create({ data: { id: userId, email: `${tag}@example.test`, name: "Eligibility fixture", role: "CUSTOMER" } });
    await prisma.customer.create({ data: { id: customerId, userId, referralCode: tag } });
    await prisma.serviceAddress.create({ data: { id: addressId, customerId, line1: "100 Test St", city: "Denver", zip: "80201" } });
    await prisma.applianceType.create({ data: { id: typeId, name: tag, slug: tag, monthlyPriceCents: 4000 } });
    await prisma.appliance.create({ data: { id: applianceId, assetNumber: tag, applianceTypeId: typeId, status: "RENTED" } });
    await prisma.rentalAgreement.create({ data: { id: agreementId, customerId, serviceAddressId: addressId, status: "ACTIVE",
      lines: { create: { label: "Washer", monthlyPriceCents: 4000, assignments: { create: { applianceId } } } } } });
  });
  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId } });
    await prisma.maintenanceRequest.deleteMany({ where: { customerId } });
    await prisma.applianceAssignment.deleteMany({ where: { applianceId } });
    await prisma.rentalAgreement.deleteMany({ where: { id: agreementId } });
    await prisma.appliance.deleteMany({ where: { id: applianceId } });
    await prisma.applianceType.deleteMany({ where: { id: typeId } });
    await prisma.serviceAddress.deleteMany({ where: { id: addressId } });
    await prisma.customer.deleteMany({ where: { id: customerId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  it.each(["DRAFT", "AWAITING_SIGNATURE", "ENDED", "CANCELLED"] as const)("rejects equipment on a %s agreement at the real submission boundary", async (status) => {
    await prisma.rentalAgreement.update({ where: { id: agreementId }, data: { status } });
    await prisma.appliance.update({ where: { id: applianceId }, data: { status: "RENTED" } });
    expect(await getPortalApplianceOptions(userId)).toEqual([]);
    const data = await getPortalData(userId);
    expect(data?.rentalAgreements[0].id).toBe(agreementId);
    expect(data?.rentalAgreements[0].lines[0].assignments).toEqual([]);
    await expect(createMaintenanceRequestForUser(userId, { problem: "Unauthorized equipment", applianceId })).rejects.toThrow(/isn't on one of your active rentals/i);
    expect(await prisma.maintenanceRequest.count({ where: { customerId } })).toBe(0);
  });
  it.each(["RESERVED", "AWAITING_INSPECTION"] as const)("rejects %s equipment even on an ACTIVE agreement", async (status) => {
    await prisma.rentalAgreement.update({ where: { id: agreementId }, data: { status: "ACTIVE" } });
    await prisma.appliance.update({ where: { id: applianceId }, data: { status } });
    expect(await getPortalApplianceOptions(userId)).toEqual([]);
    await expect(createMaintenanceRequestForUser(userId, { problem: "Not delivered equipment", applianceId })).rejects.toThrow(/active rentals/i);
    expect(await prisma.maintenanceRequest.count({ where: { customerId } })).toBe(0);
  });
  it.each(["RENTED", "AWAITING_PICKUP"] as const)("allows the customer's own currently held %s equipment", async (status) => {
    await prisma.rentalAgreement.update({ where: { id: agreementId }, data: { status: "ACTIVE" } });
    await prisma.appliance.update({ where: { id: applianceId }, data: { status } });
    expect((await getPortalApplianceOptions(userId)).map((row) => row.id)).toEqual([applianceId]);
    expect((await getPortalData(userId))?.rentalAgreements[0].lines[0].assignments[0].applianceId).toBe(applianceId);
  });
});
