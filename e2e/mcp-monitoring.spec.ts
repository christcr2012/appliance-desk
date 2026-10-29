import fs from "node:fs";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { ACCESSIBILITY_ROUTES } from "./route-inventory";

const ownerSession = "e2e/.auth/owner.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/invalid");
const isolated = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

test.describe("MCP-7 owner monitoring setup", () => {
  test.use({ storageState: fs.existsSync(ownerSession) ? ownerSession : undefined });
  test.beforeEach(() => {
    if (process.env.CI === "true") {
      expect(isolated, "Monitoring browser test must use disposable CI PostgreSQL").toBeTruthy();
      expect(fs.existsSync(ownerSession), "Monitoring browser test needs the seeded owner session").toBeTruthy();
    } else {
      test.skip(true, "Owner-monitoring browser writes run only on isolated CI.");
    }
  });
  test("owner saves and restores a monitored rule; screen stays accessible", async ({ page }) => {
    const key = "open-high-issues";
    const original = await prisma.monitorRule.findUnique({ where: { key } });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/desk/automations", { waitUntil: "load" });
      await expect(page.getByRole("heading", { name: "Monitoring", exact: true })).toBeVisible();
      const section = page.locator("#monitoring");
      const form = section.locator('form:has(input[name="key"][value="open-high-issues"])');
      await expect(form).toBeVisible();
      await form.getByRole("checkbox", { name: "Turn this check on" }).check();
      await form.getByRole("button", { name: "Save monitoring" }).click();
      await expect.poll(async () => (await prisma.monitorRule.findUnique({ where: { key } }))?.enabled,
        { timeout: 15000 }).toBe(true);
      await page.reload();
      const refreshed = page.locator("#monitoring").locator('form:has(input[name="key"][value="open-high-issues"])');
      await refreshed.getByRole("button", { name: "Restore recommended" }).click();
      await expect.poll(async () => (await prisma.monitorRule.findUnique({ where: { key } }))?.enabled,
        { timeout: 15000 }).toBe(false);
      const route = ACCESSIBILITY_ROUTES.find(item => item.path === "/desk/automations");
      expect(route).toBeDefined();
      await scanAccessibilityRoute(page, route!);
    } finally {
      if (original) {
        await prisma.monitorRule.update({ where: { key }, data: {
          enabled: original.enabled, failuresBeforeAlert: original.failuresBeforeAlert,
          cooldownHours: original.cooldownHours, notifyEmail: original.notifyEmail,
          autoAction: original.autoAction, autoActionConnectionId: original.autoActionConnectionId,
        } });
      } else {
        await prisma.monitorRule.deleteMany({ where: { key } });
      }
    }
  });
});
