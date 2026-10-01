import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const staff = "e2e/.auth/staff.json";
const url = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const enabled = process.env.CI === "true" && ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/appliance_desk_test";
test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
test("staff shared route completes a swap and follows up only its incoming unit", async ({ page }, info) => {
  test.skip(!enabled || !fs.existsSync(staff), "Disposable CI database only");
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID(); const jobId = `follow-up-${tag}`;
  const ids = ["broken", "incoming", "unrelated"].map(kind => `follow-${tag}-${kind}`);
  const assets = ["BROKEN", "INCOMING", "OTHER"].map(kind => `${kind}-${tag}`);
  try {
    const type = await prisma.applianceType.findFirstOrThrow();
    await prisma.appliance.createMany({ data: ids.map((id, i) => ({ id, assetNumber: assets[i], applianceTypeId: type.id, status: i === 0 ? "MAINTENANCE" : "RESERVED", acquisitionCostCents: 932187 })) });
    await prisma.job.create({ data: { id: jobId, type: "SWAP", status: "IN_PROGRESS", scheduledAt: new Date(), partsCostCents: 8675309, appliances: { create: ids.slice(0, 2).map(applianceId => ({ applianceId })) } } });
    await prisma.auditLog.create({ data: { action: "appliance.unit.status", entityType: "Appliance", entityId: ids[1], newValue: { jobId, reason: "Swap started", status: "RESERVED" } } });
    await page.setViewportSize({ width: 360, height: 900 });
    await page.goto("/desk/driver");
    await expect(page.getByRole("heading", { name: "Shared team route" })).toBeVisible();
    const card = page.locator("div.rounded-lg.border").filter({ has: page.getByText(assets[1], { exact: false }) }).filter({ has: page.getByRole("button", { name: "Mark complete", exact: true }) });
    await card.getByRole("button", { name: "Mark complete", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/desk/jobs/${jobId}$`));
    await expect(page.getByRole("button", { name: `Mark ${assets[0]} as Rented`, exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: `Mark ${assets[1]} as Rented`, exact: true }).click();
    await expect.poll(async () => (await prisma.appliance.findUniqueOrThrow({ where: { id: ids[1] } })).status).toBe("RENTED");
    await page.reload();
    await expect(page.getByRole("button", { name: `Mark ${assets[1]} as Rented`, exact: true })).toHaveCount(0);
    const payload = await (await page.request.get(page.url())).text();
    expect(payload).not.toMatch(/partsCostCents|laborCostCents|acquisitionCostCents|932187|8675309/);
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[0] } })).status).toBe("MAINTENANCE");
    expect((await prisma.appliance.findUniqueOrThrow({ where: { id: ids[2] } })).status).toBe("RESERVED");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations).toEqual([]);
    await info.attach("staff-swap-follow-up-phone", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  } finally {
    await prisma.auditLog.deleteMany({ where: { entityId: { in: [...ids, jobId] } } });
    await prisma.job.deleteMany({ where: { id: jobId } });
    await prisma.appliance.deleteMany({ where: { id: { in: ids } } });
  }
});
