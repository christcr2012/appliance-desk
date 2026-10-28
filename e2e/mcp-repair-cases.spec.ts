import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";

const ownerSession = "e2e/.auth/owner.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/not-test");
const syntheticOnly = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

test.describe("MCP-6 repair cases on System health", () => {
  test.use({ storageState: fs.existsSync(ownerSession) ? ownerSession : undefined });
  test.beforeEach(() => {
    test.skip(!syntheticOnly || !fs.existsSync(ownerSession), "Isolated owner and database required.");
  });

  test("labels unverified change accurately and allows owner to reject with a reason", async ({ page }) => {
    const marker = randomUUID().replaceAll("-", "");
    const issue = await prisma.systemIssue.create({ data: {
      fingerprint: "repair-e2e:" + marker, kind: "AUTOMATION_FAILED",
      severity: "MEDIUM", summary: "Synthetic repair " + marker, detail: "Test-only diagnostic evidence",
    } });
    const repair = await prisma.repairCase.create({ data: {
      sourceKind: "SYSTEM_ISSUE", sourceId: issue.id, sourceVersion: issue.version,
      fingerprint: "f".repeat(32) + marker.slice(0, 32),
      title: "Synthetic repair " + marker,
      expectedBehavior: "A nightly check completes normally", howToCheck: "automation:backup",
      baselineRevision: "a".repeat(40), stage: "IN_PROGRESS", createdByUserId: "e2e-synthetic",
      prNumber: 704,
    } });
    try {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/desk/automations", { waitUntil: "load" });
      const section = page.getByRole("region", { name: "Repairs" });
      await expect(section.getByText("Synthetic repair " + marker)).toBeVisible();
      await expect(section.getByText("Being worked on")).toBeVisible();
      const link = section.getByRole("link", { name: /View change #704 on GitHub/ });
      await expect(link).toHaveAttribute("href", "https://github.com/christcr2012/appliance-desk/pull/704");
      await section.getByRole("textbox", { name: /Reason for stopping repair/ }).fill("No longer needed");
      await section.getByRole("button", { name: "Decline repair" }).click();
      await expect.poll(async () =>
        (await prisma.repairCase.findUniqueOrThrow({ where: { id: repair.id } })).stage,
        { timeout: 15000 }).toBe("REJECTED");
      await expect(section.getByText("Declined")).toBeVisible();
      expect((await prisma.systemIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("OPEN");
    } finally {
      await prisma.repairCase.deleteMany({ where: { id: repair.id } });
      await prisma.systemIssue.deleteMany({ where: { id: issue.id } });
    }
  });

  test("Repairs content remains accessible on the owner health page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/desk/automations", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Repairs" })).toBeVisible();
    await scanAccessibilityRoute(page, "/desk/automations");
  });
});
