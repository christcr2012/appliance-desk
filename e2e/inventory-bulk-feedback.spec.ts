import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled =
  process.env.CI === "true" &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
test("bulk inventory reports distinct skipped units and persists the successful change", async ({
  page,
}, info) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID();
  const assets = ["repair", "retired", "available"].map(
    (kind) => `CI-BULK-${tag.slice(0, 8)}-${kind}`,
  );
  const type = await prisma.applianceType.findFirstOrThrow();
  const ids = assets.map((_, i) => `bulk-${tag}-${i}`);
  try {
    await prisma.appliance.createMany({
      data: ids.map((id, i) => ({
        id,
        assetNumber: assets[i],
        applianceTypeId: type.id,
        status: (["MAINTENANCE", "RETIRED", "AVAILABLE"] as const)[i],
      })),
    });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/desk/inventory");
    for (const asset of assets)
      await page.getByLabel(`Select ${asset}`, { exact: true }).check();
    await page
      .getByLabel("Set status to", { exact: true })
      .selectOption("AVAILABLE");
    await page.getByRole("button", { name: "Apply", exact: true }).click();
    const status = page
      .getByRole("status")
      .filter({ hasText: "Updated 1. Skipped 2." });
    await expect(status).toBeVisible();
    await expect(status).toContainText(assets[1]);
    await expect(status).toContainText(assets[2]);
    await expect(status).toContainText("Retired");
    await expect(status).toContainText("already its current status");
    await expect(
      page.getByLabel(`Select ${assets[0]}`, { exact: true }),
    ).not.toBeChecked();
    await expect(
      page.getByLabel(`Select ${assets[1]}`, { exact: true }),
    ).toBeChecked();
    await expect(
      page.getByLabel(`Select ${assets[2]}`, { exact: true }),
    ).toBeChecked();
    expect(
      (
        await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    await info.attach("bulk-results-phone", {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
    await page.reload();
    const saved = await prisma.appliance.findMany({
      where: { id: { in: ids } },
      orderBy: { id: "asc" },
    });
    expect(saved.map((appliance) => appliance.status)).toEqual([
      "AVAILABLE",
      "RETIRED",
      "AVAILABLE",
    ]);
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
  }
});
