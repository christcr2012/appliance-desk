import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { prisma } from "@/lib/prisma";

const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const isolated = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

test.describe("owner system health", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test.beforeEach(() => {
    test.skip(!isolated || !fs.existsSync(owner), "Isolated owner test session required.");
  });

  test("owner can resolve a source issue and recurring evidence reopens it", async ({ page }) => {
    const tag = randomUUID().replaceAll("-", "");
    const summary = "S1C test source " + tag;
    const issue = await prisma.systemIssue.create({ data: {
      fingerprint: "automation:s1c-"+tag,
      kind: "AUTOMATION_FAILED", severity: "HIGH",
      summary, detail: "Safe test-only automation evidence.",
    } });
    try {
      await page.goto("/desk/automations", { waitUntil: "load" });
      const card = page.getByTestId("system-issue-" + issue.id);
      await expect(page.getByText(summary)).toBeVisible();
      await card.getByLabel("Resolution reason (no customer information)").fill("Synthetic source reviewed");
      await card.getByRole("button", { name: "Mark resolved" }).click();
      await expect(page.getByText(summary)).toBeVisible();
      expect((await prisma.systemIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("RESOLVED");
      await prisma.systemIssue.update({ where: { id: issue.id }, data: {
        status: "OPEN", resolvedAt: null, resolvedReason: null,
        occurrences: { increment: 1 }, version: { increment: 1 },
      } });
      await page.reload();
      await expect(page.getByText(summary)).toBeVisible();
      await expect(page.getByText("OPEN", { exact: false }).first()).toBeVisible();
    } finally {
      await prisma.systemIssueNote.deleteMany({where:{issueId:issue.id}});
      await prisma.systemIssue.delete({where:{id:issue.id}});
    }
  });

  test("phone and desktop pass light/dark accessibility checks", async ({ page }) => {
    await scanAccessibilityRoute(page, {
      path: "/desk/automations", role: "OWNER", fixture: "/desk/automations",
    });
  });

});

test.describe("staff system health isolation", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("direct system health URL is denied", async ({ page }) => {
    test.skip(!isolated || !fs.existsSync(staff), "Isolated staff session required.");
    await page.goto("/desk/automations", {waitUntil:"load"});
    await expect(page).not.toHaveURL(/\/desk\/automations(?:\?|$)/);
    await expect(page.getByRole("heading", {name:"Problems the system found"})).toHaveCount(0);
  });
});
