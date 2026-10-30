import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { notify, setNotificationPreference } from "@/domains/notifications";

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

describe.skipIf(!enabled)("notification email copies (AR-13)", () => {
  const tag = randomUUID().slice(0, 8);
  let emailAdmin: string;
  let appOnlyAdmin: string;
  const userIds: string[] = [];
  const dedupeKey = `LEAD_NEW:ar13-mail-${tag}`;

  beforeAll(async () => {
    const mk = async (label: string) => {
      const user = await prisma.user.create({
        data: { email: `ar13-mail-${label}-${tag}@example.test`, name: `Mail ${label}`, role: "ADMIN" },
      });
      userIds.push(user.id);
      return user.id;
    };
    emailAdmin = await mk("email");
    appOnlyAdmin = await mk("app");
    // Email on, in-app off for one admin; the other keeps the starting values (app on, email off).
    await setNotificationPreference(emailAdmin, "LEAD_NEW", "email", true);
    await setNotificationPreference(emailAdmin, "LEAD_NEW", "inApp", false);
  });

  afterAll(async () => {
    await prisma.messageDelivery.deleteMany({ where: { idempotencyKey: { contains: `ar13-mail-${tag}` } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });

  it("email:true sends one internal email and no in-app row; the starting values do the opposite", async () => {
    const event = {
      kind: "LEAD_NEW" as const,
      dedupeKey,
      title: "New lead: Mail Fixture",
      body: "Greeley · Washer. It's on your To do list.",
      href: "/desk/leads/mail-fixture",
      entityType: "Lead",
      entityId: `ar13-mail-lead-${tag}`,
    };
    await notify(event);
    // A replay must not send a second email (the delivery idempotency key is stable).
    await notify(event);

    expect(await prisma.notification.count({ where: { userId: emailAdmin, dedupeKey } })).toBe(0);
    const deliveries = await prisma.messageDelivery.findMany({
      where: { idempotencyKey: `notification:${dedupeKey}:${emailAdmin}` },
    });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].channel).toBe("EMAIL");

    expect(await prisma.notification.count({ where: { userId: appOnlyAdmin, dedupeKey } })).toBe(1);
    expect(
      await prisma.messageDelivery.count({
        where: { idempotencyKey: `notification:${dedupeKey}:${appOnlyAdmin}` },
      }),
    ).toBe(0);
  });
});
