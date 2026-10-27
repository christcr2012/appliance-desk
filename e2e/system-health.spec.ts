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
      await expect.poll(async () =>
        (await prisma.systemIssue.findUniqueOrThrow({ where: { id: issue.id } })).status,
        { timeout: 15000 },
      ).toBe("RESOLVED");
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

  test("MCP-1: every state is explained, help links are keyboard-reachable, and raw error text never shows", async ({ page }) => {
    const tag = randomUUID().replaceAll("-", "");
    // Built at run time: a planted secret, email, phone and street in the stored legacy error text.
    const planted = [["sk", "live", "canary" + tag].join("_"), `canary-${tag}@example.test`, "(970) 555-0142", "4321 Canary Street"];
    const settings = await prisma.businessSettings.findUniqueOrThrow({ where: { id: "singleton" }, select: { pausedAutomations: true } });
    const priorPaused = Array.isArray(settings.pausedAutomations) ? settings.pausedAutomations : [];
    const run = await prisma.automationRun.create({ data: {
      ruleKey: "late-fees", runKey: "late-fees:mcp1-" + tag, environment: "ci", state: "FAILED",
      startedAt: new Date(Date.now() - 3_600_000), finishedAt: new Date(Date.now() - 3_590_000),
      error: planted.join(" "), failureCode: "TIMEOUT", failureStage: "work", correlationId: "ref-" + tag.slice(0, 10),
    } });
    const issue = await prisma.systemIssue.create({ data: {
      fingerprint: "automation:mcp1-" + tag, kind: "AUTOMATION_FAILED", severity: "HIGH",
      summary: "MCP-1 typed failure " + tag, detail: "Safe test-only automation evidence.",
      failureCode: "TIMEOUT", failureStage: "work", correlationId: "ref-" + tag.slice(10, 20),
    } });
    await prisma.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: [...priorPaused, "launch-emails"] } });
    try {
      await page.goto("/desk/automations", { waitUntil: "load" });
      for (const label of ["Working", "Late", "Failed", "Running now", "Not sure", "Hasn't run yet", "Paused", "Needs setup"]) {
        await expect(page.getByRole("region", { name: "What each status means" }).getByText(label, { exact: true })).toBeVisible();
      }
      await expect(page.getByTestId("health-row-launch-emails").getByText("Paused", { exact: true })).toBeVisible();
      // Each row shows the label for the state it reports. CI's browser server normally has no job settings, so
      // the late-fees row says Needs setup (names only); with settings present it shows the typed failure instead.
      const lateFees = page.getByTestId("health-row-late-fees");
      const state = await lateFees.getAttribute("data-state");
      const labels: Record<string, string> = { unconfigured: "Needs setup", failing: "Failed" };
      expect(Object.keys(labels)).toContain(state);
      await expect(lateFees.getByText(labels[state!]!, { exact: true })).toBeVisible();
      if (state === "unconfigured") await expect(lateFees.getByText("Missing setting name: CRON_SECRET.")).toBeVisible();
      else await expect(lateFees.getByText("Reference ref-" + tag.slice(0, 10))).toBeVisible();
      const card = page.getByTestId("system-issue-" + issue.id);
      await expect(card.getByText("The job ran out of time before it finished.")).toBeVisible();
      await expect(card.getByText("Reference ref-" + tag.slice(10, 20))).toBeVisible();
      const html = await page.content();
      for (const leaked of planted) expect(html).not.toContain(leaked);

      const helpLinks = await page.locator("[data-help-link]").evaluateAll((els) => els.map((el) => el.getAttribute("data-help-link")));
      expect(helpLinks.length).toBeGreaterThan(0);
      const reached = new Set<string>();
      for (let i = 0; i < 600 && reached.size < helpLinks.length; i += 1) {
        await page.keyboard.press("Tab");
        const id = await page.evaluate(() => document.activeElement?.getAttribute("data-help-link") ?? null);
        if (id) reached.add(id);
      }
      expect([...reached].sort()).toEqual([...helpLinks].sort());
    } finally {
      await prisma.businessSettings.update({ where: { id: "singleton" }, data: { pausedAutomations: priorPaused } });
      await prisma.systemIssue.delete({ where: { id: issue.id } });
      await prisma.automationRun.delete({ where: { id: run.id } });
    }
  });

  test("MCP-1: the owner changes and restores the late grace period", async ({ page }) => {
    await page.goto("/desk/automations#late-grace", { waitUntil: "load" });
    const box = page.getByLabel("Minutes after the usual time");
    await expect(box).toHaveValue("120");
    await box.fill("45");
    await page.getByRole("region", { name: "When a job counts as late" }).getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Now 45 minutes after a job's usual time.", { exact: false })).toBeVisible();
    await page.getByRole("region", { name: "When a job counts as late" })
      .getByRole("button", { name: "Restore recommended" }).click();
    await expect(page.getByText("Now 2 hours after a job's usual time.", { exact: false })).toBeVisible();
  });

  test("MCP-2: backup retention is owner-editable and retry appears only after failed daily backup", async ({ page }) => {
    const { businessDateKey } = await import("@/lib/business-date");
    const current = await prisma.businessSettings.findUniqueOrThrow({
      where: {id:"singleton"},select:{backupRetentionDays:true},
    });
    const key="backup:"+businessDateKey(new Date());
    const present=await prisma.automationRun.findUnique({where:{ruleKey_runKey:{ruleKey:"backup",runKey:key}}});
    test.skip(!!present,"Other fixture has today's backup run; do not change it.");
    let created:string|null=null;
    try {
      await page.goto("/desk/automations#backup-settings",{waitUntil:"load"});
      const box=page.getByLabel("Keep daily backups for (days)");
      await expect(box).toHaveValue(String(current.backupRetentionDays));
      await expect(page.getByRole("button",{name:"Run the backup again"})).toHaveCount(0);
      await box.fill("42");
      await page.locator("#backup-settings").getByRole("button",{name:"Save",exact:true}).click();
      await expect(page.locator("#backup-settings")).toContainText("Daily copies are kept for 42 days");
      await page.locator("#backup-settings").getByRole("button",{name:"Restore recommended"}).click();
      await expect(page.locator("#backup-settings")).toContainText("Daily copies are kept for 30 days");
      const row=await prisma.automationRun.create({data:{
        ruleKey:"backup",runKey:key,state:"FAILED",environment:"ci",
        startedAt:new Date(),finishedAt:new Date(),failureCode:"BACKUP_READBACK",
      }});
      created=row.id;
      await page.reload();
      await expect(page.getByRole("button",{name:"Run the backup again"})).toBeVisible();
    } finally {
      if(created)await prisma.automationRun.delete({where:{id:created}});
      await prisma.businessSettings.update({where:{id:"singleton"},data:{backupRetentionDays:current.backupRetentionDays}});
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
