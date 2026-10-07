import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertTwoFactorEnrollment,
  resetTwoFactorForRecovery,
  setTwoFactorRequiredRoles,
  twoFactorEnrollmentRequired,
} from "@/domains/security/two-factor";
import { prisma } from "@/lib/prisma";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("two-factor enforcement (real Postgres)", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = "g2-owner-" + tag;
  const adminId = "g2-admin-" + tag;
  const staffId = "g2-staff-" + tag;
  const customerId = "g2-customer-" + tag;

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `g2-owner-${tag}@example.test`, name: "G2 Owner", role: "OWNER", emailVerified: true },
        { id: adminId, email: `g2-admin-${tag}@example.test`, name: "G2 Admin", role: "ADMIN", emailVerified: true },
        { id: staffId, email: `g2-staff-${tag}@example.test`, name: "G2 Staff", role: "STAFF", emailVerified: true },
        { id: customerId, email: `g2-customer-${tag}@example.test`, name: "G2 Customer", role: "CUSTOMER", emailVerified: true },
      ],
    });
    await prisma.businessSettings.upsert({
      where: { id: "singleton" },
      create: { id: "singleton", twoFactorRequiredRoles: ["OWNER", "ADMIN"] },
      update: { twoFactorRequiredRoles: ["OWNER", "ADMIN"] },
    });
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId, customerId] } } });
    await prisma.twoFactor.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId, customerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId, customerId] } } });
    await prisma.businessSettings.update({
      where: { id: "singleton" },
      data: { twoFactorRequiredRoles: ["OWNER", "ADMIN"] },
    });
  });

  it("refuses an unenrolled Admin, allows the enrolled Admin, and leaves Staff unaffected by default", async () => {
    await expect(assertTwoFactorEnrollment(adminId, "ADMIN")).rejects.toThrow(/setup is required/i);
    expect(await twoFactorEnrollmentRequired(staffId, "STAFF")).toBe(false);

    await prisma.user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
    await expect(assertTwoFactorEnrollment(adminId, "ADMIN")).resolves.toBeUndefined();
  });

  it("lets the Owner add Staff to the required policy and records the change", async () => {
    const roles = await setTwoFactorRequiredRoles(ownerId, ["OWNER", "ADMIN", "STAFF", "CUSTOMER"]);
    expect(roles).toEqual(["OWNER", "ADMIN", "STAFF"]);
    expect(await twoFactorEnrollmentRequired(staffId, "STAFF")).toBe(true);
    expect(await prisma.auditLog.findFirst({
      where: { userId: ownerId, action: "security.two_factor.policy" },
    })).not.toBeNull();
  });

  it("recovery reset deletes the factor, clears the flag, and leaves audit evidence", async () => {
    await prisma.user.update({ where: { id: adminId }, data: { twoFactorEnabled: true } });
    await prisma.twoFactor.create({
      data: {
        id: "g2-factor-" + tag,
        userId: adminId,
        secret: "encrypted-secret-test",
        backupCodes: "encrypted-backup-test",
        verified: true,
      },
    });
    const email = `g2-admin-${tag}@example.test`;
    await expect(resetTwoFactorForRecovery(email)).resolves.toBe(email);
    expect(await prisma.twoFactor.findUnique({ where: { userId: adminId } })).toBeNull();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: adminId } })).twoFactorEnabled).toBe(false);
    expect(await prisma.auditLog.findFirst({
      where: { userId: adminId, action: "security.two_factor.recovery_reset" },
    })).not.toBeNull();
  });
});
