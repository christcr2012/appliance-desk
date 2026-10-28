import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { setFeatureShown } from "@/domains/features/write";

const target = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(target.hostname) &&
  target.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("AR-12 owner-only feature choices (real PostgreSQL)", () => {
  const tag = randomUUID().slice(0, 8);
  const ids = { owner: "feat-o-" + tag, admin: "feat-a-" + tag, staff: "feat-s-" + tag, accountant: "feat-c-" + tag };
  let previous: string[] = [];

  beforeAll(async () => {
    previous = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { shownFeatures: true } })).shownFeatures;
    for (const [role, id] of Object.entries(ids)) await prisma.user.create({
      data: { id, name: "Feature Test", email: id + "@example.test", role: role.toUpperCase() as "OWNER" | "ADMIN" | "STAFF" | "ACCOUNTANT", emailVerified: true },
    });
  });
  afterAll(async () => {
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { shownFeatures: previous } });
    await prisma.auditLog.deleteMany({ where: { action: "settings.features", userId: ids.owner } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
  });

  it("refuses invalid choices and every non-owner role before touching settings", async () => {
    await expect(setFeatureShown(ids.admin, "phoneCosts", true)).rejects.toThrow(/no longer has access/);
    await expect(setFeatureShown(ids.staff, "phoneCosts", true)).rejects.toThrow(/no longer has access/);
    await expect(setFeatureShown(ids.accountant, "phoneCosts", true)).rejects.toThrow(/no longer has access/);
    await expect(setFeatureShown(ids.owner, "unknown", true)).rejects.toThrow(/not available/);
    await expect(setFeatureShown(ids.owner, "phoneCosts", "true" as unknown as boolean)).rejects.toThrow(/Choose whether/);
    expect(await prisma.auditLog.count({ where: { action: "settings.features", userId: ids.owner } })).toBe(0);
  });

  it("adds and removes each choice, audits only actual changes and ignores double-submits", async () => {
    expect((await setFeatureShown(ids.owner, "phoneCosts", true)).changed).toBe(true);
    expect((await setFeatureShown(ids.owner, "phoneCosts", true)).changed).toBe(false);
    expect((await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).shownFeatures).toContain("phoneCosts");
    expect((await setFeatureShown(ids.owner, "phoneCosts", false)).changed).toBe(true);
    expect((await setFeatureShown(ids.owner, "phoneCosts", false)).changed).toBe(false);
    const audits = await prisma.auditLog.findMany({ where: { action: "settings.features", userId: ids.owner } });
    expect(audits).toHaveLength(2);
  });

  it("serializes simultaneous changes to different feature keys without losing either", async () => {
    const before = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).shownFeatures;
    await Promise.all([
      setFeatureShown(ids.owner, "phoneCosts", true),
      setFeatureShown(ids.owner, "bankStatements", true),
    ]);
    const after = (await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } })).shownFeatures;
    expect(after).toEqual(expect.arrayContaining(["phoneCosts", "bankStatements"]));
    for (const key of ["phoneCosts", "bankStatements"]) {
      if (!before.includes(key)) await setFeatureShown(ids.owner, key, false);
    }
  });

  it("immediately refuses a disabled owner account", async () => {
    await prisma.user.update({ where: { id: ids.owner }, data: { archivedAt: new Date() } });
    await expect(setFeatureShown(ids.owner, "accountantExports", true)).rejects.toThrow(/no longer has access/);
    await prisma.user.update({ where: { id: ids.owner }, data: { archivedAt: null } });
  });
});
