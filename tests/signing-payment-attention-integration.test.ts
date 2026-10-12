import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  session: vi.fn(),
  twoFactor: vi.fn(async () => false),
}));
vi.mock("@/lib/auth", () => ({
  auth: { api: { getSession: (...args: unknown[]) => authMocks.session(...args) } },
}));
vi.mock("@/domains/security/two-factor", () => ({
  twoFactorEnrollmentRequired: (...args: unknown[]) => authMocks.twoFactor(...args),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error("NEXT_REDIRECT:" + path); },
}));

import { prisma } from "@/lib/prisma";
import { listSigningPaymentAttention } from "@/domains/exceptions/signing-payment-attention";

const database = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(database.hostname) &&
  database.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("W-22 unpaid signing To do (actual PostgreSQL and requireRole)", () => {
  const tag = randomUUID().replaceAll("-", "");
  let userId = "";
  let staffId = "";
  let adminId = "";
  let customerId = "";
  let addressId = "";
  const agreements: string[] = [];
  const signDates = [
    new Date("2026-01-10T14:00:00.000Z"),
    new Date("2026-01-11T14:00:00.000Z"),
    new Date("2026-01-12T14:00:00.000Z"),
  ];
  const acting = (id: string, role: string, archivedAt: Date | null = null) => {
    authMocks.session.mockResolvedValue({ user: { id, role, archivedAt } });
  };

  beforeAll(async () => {
    authMocks.twoFactor.mockResolvedValue(false);
    userId = (await prisma.user.create({ data: {
      email: "w22-pay-customer-" + tag + "@test.invalid",
      role: "CUSTOMER", emailVerified: true,
    } })).id;
    staffId = (await prisma.user.create({ data: {
      email: "w22-pay-staff-" + tag + "@test.invalid",
      role: "STAFF", emailVerified: true,
    } })).id;
    adminId = (await prisma.user.create({ data: {
      email: "w22-pay-admin-" + tag + "@test.invalid",
      role: "ADMIN", emailVerified: true,
    } })).id;
    customerId = (await prisma.customer.create({ data: {
      userId, referralCode: "PAYOUT-" + tag,
    } })).id;
    addressId = (await prisma.serviceAddress.create({ data: {
      customerId, line1: "7 Review Place", city: "Greeley", zip: "80631",
    } })).id;
    for (let i = 0; i < signDates.length; i++) {
      const a = await prisma.rentalAgreement.create({
        data: { customerId, serviceAddressId: addressId },
      });
      agreements.push(a.id);
      const cents = i === 1 ? 0 : (i === 0 ? 3500 : 7200);
      await prisma.agreementSigningPayment.create({ data: {
        agreementId: a.id,
        orderFingerprint: "a".repeat(64),
        evidenceVersion: 1,
        setupFeeCents: 0,
        setupTaxCents: 0,
        downPaymentCents: cents,
        totalCents: cents,
        status: cents ? "AWAITING_PAYMENT" : "NOT_DUE",
        signedAt: signDates[i]!,
      } });
    }
  });

  afterAll(async () => {
    if (agreements.length) {
      await prisma.agreementSigningPayment.deleteMany({
        where: { agreementId: { in: agreements } },
      });
      await prisma.rentalAgreement.deleteMany({
        where: { id: { in: agreements } },
      });
    }
    if (addressId) await prisma.serviceAddress.delete({ where: { id: addressId } });
    if (customerId) await prisma.customer.delete({ where: { id: customerId } });
    if (userId) await prisma.user.delete({ where: { id: userId } });
    if (staffId) await prisma.user.delete({ where: { id: staffId } });
    if (adminId) await prisma.user.delete({ where: { id: adminId } });
  });

  it("OWNER and ADMIN see only genuine unpaid agreement rows with exact cents", async () => {
    const owner = await prisma.user.findFirstOrThrow({ where: { role: "OWNER" } });
    for (const [id, role] of [[owner.id, "OWNER"], [adminId, "ADMIN"]]) {
      acting(id, role);
      const results = await listSigningPaymentAttention(50);
      const ours = results.rows.filter(x => agreements.some(a =>
        x.href === "/desk/agreements/" + a));
      expect(ours).toHaveLength(2);
      expect(ours.map(x => x.amountCents)).toEqual([3500, 7200]);
      expect(ours.map(x => x.since)).toEqual([signDates[0], signDates[2]]);
      expect(results.rows.find(x => x.href.endsWith(agreements[1]!))).toBeUndefined();
      expect(ours[0].primaryAction?.href).toBe("/desk/agreements/" + agreements[0]);
      expect(ours[0].detail).toContain("not been recorded as paid");
    }
  });

  it("STAFF and CUSTOMER are rejected by real requireRole, not Prisma mocks", async () => {
    for (const [id, role] of [[staffId, "STAFF"], [userId, "CUSTOMER"]]) {
      acting(id, role);
      await expect(listSigningPaymentAttention(50)).rejects.toThrow("NEXT_REDIRECT:/");
    }
  });

  it("rejects deactivated finance identities and unsigned sessions", async () => {
    acting(adminId, "ADMIN", new Date("2025-01-01T00:00:00Z"));
    await expect(listSigningPaymentAttention(50)).rejects.toThrow(/NEXT_REDIRECT:\/login\?deactivated=1/);
    authMocks.session.mockResolvedValue(null);
    await expect(listSigningPaymentAttention(50)).rejects.toThrow("NEXT_REDIRECT:/login");
  });

  it("returns the oldest due record and the true bounded total without looking at waived rows", async () => {
    acting(adminId, "ADMIN");
    const limited = await listSigningPaymentAttention(1);
    expect(limited.rows).toHaveLength(1);
    expect(limited.rows[0].href).toBe("/desk/agreements/" + agreements[0]);
    expect(limited.total).toBeGreaterThanOrEqual(2);
  });
});
