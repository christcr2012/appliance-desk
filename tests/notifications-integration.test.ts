import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import {
  cleanupOldNotifications,
  getNotificationPreferences,
  getUnreadCount,
  listNotifications,
  markRead,
  notify,
  setNotificationPreference,
} from "@/domains/notifications";
import { changeAccessLevel } from "@/domains/team";
import { assignJobRole } from "@/domains/team/job-roles";

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

describe.skipIf(!enabled)("notifications domain (AR-13)", () => {
  const tag = randomUUID().slice(0, 8);
  let ownerId: string;
  let adminId: string;
  let staffId: string;
  const userIds: string[] = [];
  const jobRoleIds: string[] = [];

  async function makeUser(role: "ADMIN" | "STAFF", label: string) {
    const user = await prisma.user.create({
      data: { email: `ar13-${label}-${tag}@example.test`, name: `AR13 ${label}`, role },
    });
    userIds.push(user.id);
    return user.id;
  }

  const leadEvent = (dedupeSuffix: string) => ({
    kind: "LEAD_NEW" as const,
    dedupeKey: `LEAD_NEW:ar13-${tag}-${dedupeSuffix}`,
    title: "New lead: Fixture",
    body: "Greeley · Washer. It's on your To do list.",
    href: "/desk/leads/fixture-lead",
    entityType: "Lead",
    entityId: `ar13-lead-${tag}-${dedupeSuffix}`,
  });

  beforeAll(async () => {
    ownerId = (await prisma.user.findFirstOrThrow({ where: { role: "OWNER", archivedAt: null } })).id;
    adminId = await makeUser("ADMIN", "admin");
    staffId = await makeUser("STAFF", "staff");
  });

  afterAll(async () => {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ entityId: { in: userIds } }, { userId: { in: userIds } }] } });
    await prisma.staffCapabilityOverride.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.jobRole.deleteMany({ where: { id: { in: jobRoleIds } } });
  });

  it("notify creates one row per recipient and a replay creates no duplicates", async () => {
    await notify(leadEvent("a"));
    await notify(leadEvent("a"));
    const adminRows = await prisma.notification.findMany({ where: { userId: adminId, kind: "LEAD_NEW" } });
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0].title).toBe("New lead: Fixture");
    // The staff member (no job role, but staff are not lead recipients without an assignment) got none.
    expect(await prisma.notification.count({ where: { userId: staffId } })).toBe(0);
    expect(await getUnreadCount(adminId)).toBe(1);
  });

  it("an inApp-off preference skips the row; the preference reads back with starting values elsewhere", async () => {
    await setNotificationPreference(adminId, "LEAD_NEW", "inApp", false);
    await notify(leadEvent("b"));
    expect(await prisma.notification.count({ where: { userId: adminId, dedupeKey: `LEAD_NEW:ar13-${tag}-b` } })).toBe(0);
    const prefs = await getNotificationPreferences(adminId);
    expect(prefs.find((p) => p.kind === "LEAD_NEW")).toEqual({ kind: "LEAD_NEW", inApp: false, email: false });
    expect(prefs.find((p) => p.kind === "PAYMENT_FAILED")).toEqual({ kind: "PAYMENT_FAILED", inApp: true, email: false });
    await setNotificationPreference(adminId, "LEAD_NEW", "inApp", true);
  });

  it("notify refuses a link outside the desk", async () => {
    await expect(notify({ ...leadEvent("bad"), href: "https://example.test/phish" })).rejects.toThrow(/must start with \/desk\//);
  });

  it("markRead touches only the owner's own row", async () => {
    const row = await prisma.notification.findFirstOrThrow({ where: { userId: adminId, readAt: null } });
    await markRead(ownerId, row.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).toBeNull();
    await markRead(adminId, row.id);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: row.id } })).readAt).not.toBeNull();
    expect(await getUnreadCount(adminId)).toBe(0);
  });

  it("demoting an admin to staff deletes the kinds they can no longer receive, with an audit row", async () => {
    await prisma.notification.create({
      data: {
        userId: adminId, kind: "PAYMENT_FAILED", title: "Payment failed: Fixture", body: "Body",
        href: "/desk/billing/customer/c/invoice/i", entityType: "Invoice", entityId: `ar13-inv-${tag}`,
        dedupeKey: `PAYMENT_FAILED:ar13-${tag}`,
      },
    });
    expect(await getUnreadCount(adminId)).toBeGreaterThan(0);
    await changeAccessLevel(ownerId, adminId, "STAFF");
    expect(await prisma.notification.count({ where: { userId: adminId, kind: "PAYMENT_FAILED" } })).toBe(0);
    expect(await getUnreadCount(adminId)).toBe(0);
    expect((await listNotifications(adminId)).rows.every((r) => r.kind !== "PAYMENT_FAILED")).toBe(true);
    const audit = await prisma.auditLog.findFirst({
      where: { action: "notifications.removed_on_access_change", entityId: adminId },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).not.toBeNull();
    // Re-promotion does not bring the deleted rows back.
    await changeAccessLevel(ownerId, adminId, "ADMIN");
    expect(await prisma.notification.count({ where: { userId: adminId, kind: "PAYMENT_FAILED" } })).toBe(0);
  });

  it("the nightly clean-up deletes read rows past the keep-days and keeps unread and recent rows", async () => {
    const day = 86_400_000;
    const mk = (suffix: string, readAt: Date | null, createdDaysAgo: number) =>
      prisma.notification.create({
        data: {
          userId: adminId, kind: "LEAD_NEW", title: `Cleanup ${suffix}`, body: "Body",
          href: "/desk/leads/fixture-lead", entityType: "Lead", entityId: `ar13-clean-${tag}-${suffix}`,
          dedupeKey: `LEAD_NEW:ar13-clean-${tag}-${suffix}`,
          readAt, createdAt: new Date(Date.now() - createdDaysAgo * day),
        },
      });
    await mk("old-read", new Date(Date.now() - 100 * day), 120);
    await mk("recent-read", new Date(Date.now() - 10 * day), 30);
    await mk("old-unread", null, 400);
    const removed = await cleanupOldNotifications(new Date());
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { dedupeKey: `LEAD_NEW:ar13-clean-${tag}-old-read` } })).toBe(0);
    expect(await prisma.notification.count({ where: { dedupeKey: `LEAD_NEW:ar13-clean-${tag}-recent-read` } })).toBe(1);
    expect(await prisma.notification.count({ where: { dedupeKey: `LEAD_NEW:ar13-clean-${tag}-old-unread` } })).toBe(1);
  });

  it("narrowing a job role to remove leads deletes LEAD_NEW rows", async () => {
    await notify(leadEvent("c"));
    expect(await prisma.notification.count({ where: { userId: adminId, kind: "LEAD_NEW" } })).toBeGreaterThan(0);
    const role = await prisma.jobRole.create({
      data: { label: `AR13 no-leads ${tag}`, accessLevel: "ADMIN", screens: ["customers", "tasks"] },
    });
    jobRoleIds.push(role.id);
    await assignJobRole(ownerId, adminId, role.id);
    expect(await prisma.notification.count({ where: { userId: adminId, kind: "LEAD_NEW" } })).toBe(0);
    await assignJobRole(ownerId, adminId, null);
  });
});
