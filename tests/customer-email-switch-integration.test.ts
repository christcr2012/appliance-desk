import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const send = vi.hoisted(() => vi.fn());
vi.mock("@/lib/email", () => ({ sendEmail: send }));

import { prisma } from "@/lib/prisma";
import { sendCustomerEmail } from "@/lib/customer-email";
import { isCustomerEmailEnabled, setCustomerEmailEnabled } from "@/domains/settings/customer-email-switch";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("the owner's master switch for emails to customers", () => {
  const tag = randomUUID().replaceAll("-", "");
  const ownerId = `ce-owner-${tag}`;
  const adminId = `ce-admin-${tag}`;
  const staffId = `ce-staff-${tag}`;
  let before: boolean | null = null;

  beforeAll(async () => {
    const row = await prisma.businessSettings.findUnique({ where: { id: "singleton" }, select: { customerEmailEnabled: true } });
    before = row ? row.customerEmailEnabled : null;
    await prisma.user.createMany({
      data: [
        { id: ownerId, email: `${tag}-o@example.test`, name: "O", role: "OWNER", emailVerified: true },
        { id: adminId, email: `${tag}-a@example.test`, name: "A", role: "ADMIN", emailVerified: true },
        { id: staffId, email: `${tag}-s@example.test`, name: "S", role: "STAFF", emailVerified: true },
      ],
    });
  });

  afterAll(async () => {
    if (before === null) await prisma.businessSettings.deleteMany({ where: { id: "singleton" } });
    else await prisma.businessSettings.update({ where: { id: "singleton" }, data: { customerEmailEnabled: before } });
    await prisma.auditLog.deleteMany({ where: { userId: { in: [ownerId, adminId, staffId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, adminId, staffId] } } });
  });

  it("starts off, sends nothing while off, sends when the owner turns it on, and logs each change", async () => {
    await setCustomerEmailEnabled(ownerId, false);
    send.mockReset().mockResolvedValue({ sent: true });
    expect(await isCustomerEmailEnabled()).toBe(false);
    expect(await sendCustomerEmail({ to: "c@example.test", subject: "s", text: "t" })).toEqual({ sent: false });
    expect(send).not.toHaveBeenCalled();

    await setCustomerEmailEnabled(ownerId, true);
    expect(await sendCustomerEmail({ to: "c@example.test", subject: "s", text: "t" })).toEqual({ sent: true });
    expect(send).toHaveBeenCalledTimes(1);

    await setCustomerEmailEnabled(ownerId, false);
    expect(await prisma.auditLog.count({ where: { userId: ownerId, action: { in: ["settings.customer_email_on", "settings.customer_email_off"] } } })).toBe(3);
  });

  it("only the owner can change it: an admin or staff member is refused", async () => {
    await setCustomerEmailEnabled(ownerId, false);
    await expect(setCustomerEmailEnabled(adminId, true)).rejects.toThrow();
    await expect(setCustomerEmailEnabled(staffId, true)).rejects.toThrow();
    expect(await isCustomerEmailEnabled()).toBe(false);
  });
});
