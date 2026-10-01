// Real rollback proof. Runs only in CI against its disposable local Postgres.
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateBusinessSettings } from "@/domains/settings";
it.skipIf(process.env.CI !== "true")(
  "rolls back a settings write if its audit cannot be stored",
  async () => {
    const url = new URL(process.env.DATABASE_URL!);
    expect(["localhost", "127.0.0.1"]).toContain(url.hostname);
    expect(url.pathname).toBe("/appliance_desk_test");
    const before = await prisma.businessSettings.findUniqueOrThrow({
      where: { id: "singleton" },
    });
    const invalidAuthor = `missing-author-${randomUUID()}`;
    try {
      await expect(
        updateBusinessSettings(invalidAuthor, {
          publicBusinessName: "CI must roll this back",
        }),
      ).rejects.toThrow();
      const after = await prisma.businessSettings.findUniqueOrThrow({
        where: { id: "singleton" },
      });
      expect(after.publicBusinessName).toBe(before.publicBusinessName);
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(
        await prisma.auditLog.count({ where: { userId: invalidAuthor } }),
      ).toBe(0);
    } finally {
      // Own disposable fixture only; preserves the seed if the assertion catches a regression.
      await prisma.businessSettings.update({
        where: { id: "singleton" },
        data: { publicBusinessName: before.publicBusinessName },
      });
    }
  },
);
