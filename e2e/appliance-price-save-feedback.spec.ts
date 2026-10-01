import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const owner = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

test("saved non-placeholder business name composes home and child browser titles", async ({ page }) => {
  test.skip(!enabled, "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const { publicBusinessName } = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" } });
  const fixtureName = `Title fixture ${randomUUID()}`;
  try {
    // The disposable seed intentionally uses a placeholder. Own this temporary
    // value and restore it conditionally; no production settings are touched.
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { publicBusinessName: fixtureName } });
    for (const [path, title] of [["/", `${fixtureName} — Appliance Rentals in Colorado`], ["/pricing", `Pricing — ${fixtureName}`]]) {
      await page.goto(path);
      await expect(page).toHaveTitle(title);
      expect(await page.title()).not.toContain("[Company Name]");
    }
  } finally {
    await prisma.businessSettings.updateMany({ where: { id: "singleton", publicBusinessName: fixtureName }, data: { publicBusinessName } });
  }
});

test("phone price editor reports rejected saves and persists a confirmed correction", async ({ page }, info) => {
  test.skip(!enabled || !fs.existsSync(owner), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const id = `price-${randomUUID()}`;
  const name = `Price test ${id}`;
  try {
    await prisma.applianceType.create({ data: { id, name, slug: id, monthlyPriceCents: 4000 } });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/desk/settings?section=products");
    const row = page.getByRole("row").filter({ has: page.getByText(name, { exact: true }) });
    const input = row.getByRole("spinbutton", { name: `Monthly price for ${name}` });
    for (const value of ["", "-5"]) {
      await input.fill(value);
      await row.getByRole("button", { name: "Save", exact: true }).click();
      await expect(row.getByRole("alert")).toHaveText("Enter a valid price.");
      await expect(row.getByRole("status")).toHaveCount(0);
      expect((await prisma.applianceType.findUniqueOrThrow({ where: { id } })).monthlyPriceCents).toBe(4000);
    }
    await input.fill("45.25");
    await row.getByRole("button", { name: "Save", exact: true }).click();
    await expect(row.getByRole("status")).toHaveText("Saved");
    await expect(row.getByRole("alert")).toHaveCount(0);
    expect((await prisma.applianceType.findUniqueOrThrow({ where: { id } })).monthlyPriceCents).toBe(4525);
    expect(await prisma.pricingRule.count({ where: { applianceTypeId: id, oldValueCents: 4000, newValueCents: 4525 } })).toBe(1);
    await page.reload();
    await expect(input).toHaveValue("45.25");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await info.attach("price-save-confirmed-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    await prisma.pricingRule.deleteMany({ where: { applianceTypeId: id } });
    await prisma.auditLog.deleteMany({ where: { entityId: id } });
    await prisma.applianceType.deleteMany({ where: { id } });
  }
});
