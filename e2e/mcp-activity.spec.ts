import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { prisma } from "@/lib/prisma";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { ACCESSIBILITY_ROUTES } from "./route-inventory";

const ownerSession = "e2e/.auth/owner.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://invalid");
const syntheticOnly = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/**
 * MCP-5's browser line: the Assistant Activity section on /desk/automations
 * lists waiting assistant actions; the owner approves (through the confirm
 * dialog with the previewed changes) or declines, and the journal records
 * the decision. Seeds synthetic AWAITING_APPROVAL operations directly, in
 * the same shape createJournalPreview writes them, and removes them after.
 */
test.describe("MCP-5 assistant activity approvals", () => {
  test.use({ storageState: fs.existsSync(ownerSession) ? ownerSession : undefined });
  test.beforeEach(() => {
    if (process.env.CI === "true") {
      expect(syntheticOnly, "MCP-5 browser verification requires the disposable CI database").toBeTruthy();
      expect(fs.existsSync(ownerSession), "MCP-5 browser verification requires the seeded CI owner session").toBeTruthy();
    } else {
      test.skip(true, "Use the isolated CI browser runner; never write synthetic operations to a shared database.");
    }
  });

  async function seedWaitingOperation(marker: string) {
    const owner = await prisma.user.findFirstOrThrow({
      where: { email: process.env.OWNER_EMAIL ?? "ci-owner@example.test" },
      select: { id: true },
    });
    const connection = await prisma.mcpConnection.create({
      data: {
        userId: owner.id,
        oauthClientId: "e2e-mcp5-" + marker,
        label: "E2E assistant " + marker,
        scopes: ["ops:maintain"],
      },
    });
    const args = { key: "e2e-" + marker };
    const operation = await prisma.agentOperation.create({
      data: {
        connectionId: connection.id,
        actorUserId: owner.id,
        tool: "ops_pause_automation",
        action: "PAUSE_AUTOMATION",
        targetRef: "automation:e2e-" + marker,
        requestKeyDigest: sha256(connection.id + ":e2e-" + marker),
        connectionGrantVersion: connection.grantVersion,
        argsHash: sha256(JSON.stringify(args)),
        args,
        preview: {
          summary: "Pause the e2e automation " + marker,
          changes: [{ label: "Automation " + marker, now: "Running", after: "Paused" }],
        },
        state: "AWAITING_APPROVAL",
        expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      },
    });
    return { owner, connection, operation };
  }

  async function cleanup(connectionId: string) {
    await prisma.agentOperation.deleteMany({ where: { connectionId } });
    await prisma.mcpConnection.deleteMany({ where: { id: connectionId } });
  }

  test("owner approves on phone and declines on desktop; the journal records both", async ({ page }) => {
    const markerA = randomUUID().replaceAll("-", "").slice(0, 12);
    const markerB = randomUUID().replaceAll("-", "").slice(0, 12);
    const a = await seedWaitingOperation(markerA);
    const b = await seedWaitingOperation(markerB);
    try {
      const section = page.getByRole("region", { name: "Assistant activity" });

      // Phone: approve through the confirm dialog, which shows the previewed changes.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/desk/automations", { waitUntil: "load" });
      const rowA = section.locator("li", { hasText: markerA });
      await expect(rowA.getByText("Waiting for you")).toBeVisible();
      await expect(async () => {
        await rowA.getByRole("button", { name: "Approve", exact: true }).click();
        await expect(page.getByRole("alertdialog")).toBeVisible({ timeout: 3000 });
      }).toPass({ timeout: 30_000 });
      const dialog = page.getByRole("alertdialog");
      await expect(dialog.getByText("Approve assistant action?")).toBeVisible();
      await expect(dialog.getByText("Automation " + markerA)).toBeVisible();
      await expect(dialog.getByText("Running")).toBeVisible();
      await expect(dialog.getByText("Paused")).toBeVisible();
      await dialog.getByRole("button", { name: "Approve this action" }).click();
      await expect.poll(async () =>
        (await prisma.agentOperation.findUniqueOrThrow({ where: { id: a.operation.id } })).state,
        { timeout: 15000 }).toBe("AUTHORIZED");
      const approved = await prisma.agentOperation.findUniqueOrThrow({ where: { id: a.operation.id } });
      expect(approved.approvedByUserId).toBe(a.owner.id);
      await expect(rowA.getByText("Approved", { exact: true })).toBeVisible();

      // Desktop: decline submits directly and consumes the waiting state.
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/desk/automations", { waitUntil: "load" });
      const rowB = section.locator("li", { hasText: markerB });
      await expect(rowB.getByText("Waiting for you")).toBeVisible();
      await rowB.getByRole("button", { name: "Decline", exact: true }).click();
      await expect.poll(async () =>
        (await prisma.agentOperation.findUniqueOrThrow({ where: { id: b.operation.id } })).state,
        { timeout: 15000 }).toBe("DENIED");
      await expect(rowB.getByText("Declined", { exact: true })).toBeVisible();
    } finally {
      await cleanup(a.connection.id);
      await cleanup(b.connection.id);
    }
  });

  test("assistant activity with a waiting action passes accessibility scans", async ({ page }) => {
    const marker = randomUUID().replaceAll("-", "").slice(0, 12);
    const seeded = await seedWaitingOperation(marker);
    try {
      const route = ACCESSIBILITY_ROUTES.find((item) => item.path === "/desk/automations");
      expect(route).toBeDefined();
      await scanAccessibilityRoute(page, route!);
      const section = page.getByRole("region", { name: "Assistant activity" });
      await expect(section.getByText("Pause the e2e automation " + marker)).toBeVisible();
    } finally {
      await cleanup(seeded.connection.id);
    }
  });
});
