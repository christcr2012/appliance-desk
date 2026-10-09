import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { isLegacySmsDispatchEnabled } from "@/domains/messaging/sms-activation";

const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/disabled");
const enabled = process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";

describe.skipIf(!enabled)("independent SMS master switch", () => {
  it("defaults OFF, even when customer email is allowed, and supports owner enable/disable", async () => {
    const existing = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
      select: { customerSmsEnabled: true, customerEmailEnabled: true },
    });
    try {
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { customerSmsEnabled: false, customerEmailEnabled: true },
      });
      expect(await isLegacySmsDispatchEnabled()).toBe(false);
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { customerSmsEnabled: true, customerEmailEnabled: false },
      });
      expect(await isLegacySmsDispatchEnabled()).toBe(true);
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: existing });
    }
  });
});
