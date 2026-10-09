import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

const owner = "e2e/.auth/owner.json";
const admin = "e2e/.auth/admin.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/not-test");
const safe = process.env.CI === "true" && url.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(url.hostname);

test.describe("owner AI check-up keys", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => { test.skip(!safe || !fs.existsSync(owner), "Isolated owner session required."); });
  test("creates once, shows once and revokes; browser cannot recover the key", async ({ page }) => {
    const label = "Checkup " + randomUUID().slice(0, 8);
    let id: string | undefined;
    try {
      await page.goto("/desk/automations", { waitUntil: "load" });
      await page.getByRole("textbox", { name: "Key label" }).fill(label);
      await page.getByRole("button", { name: "Create AI check-up key" }).click();
      const newKey = page.getByLabel("New AI check-up key");
      await expect(newKey).toBeVisible();
      expect((await newKey.innerText()).trim()).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const row = await prisma.opsAgentKey.findFirstOrThrow({ where: { label }, select: { id: true, keyHash: true } });
      id = row.id;
      expect(row.keyHash).not.toBe(await newKey.innerText());
      await page.reload();
      await expect(page.getByLabel("New AI check-up key")).toHaveCount(0);
      const listItem = page.getByRole("listitem").filter({ hasText: label });
      await listItem.getByRole("button", { name: "Revoke key" }).click();
      await expect.poll(async () =>
        (await prisma.opsAgentKey.findUniqueOrThrow({ where: { id: id! } })).revokedAt,
        { timeout: 15000 },
      ).not.toBeNull();
    } finally {
      if (id) await prisma.opsAgentKey.delete({ where: { id } });
    }
  });
  test("AI check-up key panel passes accessible phone/desktop themes", async ({ page }) => {
    await scanAccessibilityRoute(page, { path: "/desk/automations", role: "OWNER", fixture: "/desk/automations" });
  });
});

test.describe("ADMIN cannot issue keys", () => {
  test.use({ storageState: fs.existsSync(admin) ? admin : undefined });
  test("ADMIN sees no create or revoke actions", async ({ page }) => {
    test.skip(!safe || !fs.existsSync(admin), "Isolated ADMIN session required.");
    await page.goto("/desk/automations", { waitUntil: "load" });
    await expect(page.getByRole("button", { name: "Create AI check-up key" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Revoke key" })).toHaveCount(0);
  });
});
