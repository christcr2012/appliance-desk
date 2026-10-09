import fs from "node:fs";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const isolated = process.env.CI === "true" && db.pathname === "/appliance_desk_test"
  && ["localhost", "127.0.0.1"].includes(db.hostname);

test.describe("sales tax areas and exemption navigation", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test("owner sees rate review, sources and correct certificate destination", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated owner fixture required");
    await page.setViewportSize({ width: 360, height: 780 });
    await page.goto("/desk/sales-tax/areas");
    await expect(page.getByRole("heading", { name: "Tax areas and official rate sources" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Official rate review and undo" })).toBeVisible();
    await page.getByRole("navigation", { name: "Sales tax sections" }).getByRole("link", { name: "Exemptions" }).click();
    await expect(page.getByRole("heading", { name: "Exemption certificates" })).toBeVisible();
    await expect(page.getByText(/existing customer tax exemptions panel/i)).toBeVisible();
  });
  test("official provider failure is visible and never shown as verified", async ({ page }) => {
    test.skip(!fs.existsSync(owner) || !isolated, "Requires test-only owner and isolated CI database");
    const label = "T7B failure " + randomUUID().slice(0, 8);
    const source = await prisma.officialSourceWatch.create({ data: {
      label, url: "https://example.org/fixture-" + randomUUID(),
      active: true, lastError: "Synthetic provider unavailable",
      consecutiveFailures: 3, lastCheckedAt: new Date(),
    } });
    try {
      await page.goto("/desk/sales-tax/areas#sources");
      await expect(page.getByText(label)).toBeVisible();
      await expect(page.getByText(/Synthetic provider unavailable/)).toBeVisible();
    } finally {
      await prisma.officialSourceWatch.delete({ where: { id: source.id } });
    }
  });
  test("owner can recover a FAILED address by verifying reviewed tax jurisdictions", async ({ page }) => {
    test.skip(!isolated || !fs.existsSync(owner), "Isolated authenticated fixture required");
    const token = randomUUID().replaceAll("-", "");
    const customer = await prisma.customer.findFirstOrThrow({ select: { id: true } });
    const jurisdiction = await prisma.taxJurisdiction.create({ data: {
      code: "T7B" + token.slice(0, 12),
      name: "T7B reviewed tax area " + token.slice(0, 6),
      level: "CITY", administration: "STATE_COLLECTED", reviewStatus: "REVIEWED",
    } });
    const address = await prisma.serviceAddress.create({ data: {
      customerId: customer.id, line1: "T7B failure " + token.slice(0, 8),
      city: "Greeley", state: "CO", zip: "80631",
    } });
    await prisma.addressTaxLocation.create({ data: {
      serviceAddressId: address.id, status: "FAILED", source: "MANUAL",
      lookedUpAt: new Date(), createdAt: new Date("2001-01-01"),
      isCurrent: true, reviewNote: "Synthetic NOT_FOUND from provider",
    } });
    try {
      await page.goto("/desk/sales-tax/areas?status=REVIEW");
      const row = page.getByRole("listitem").filter({ hasText: address.line1 });
      await expect(row.getByText("Lookup failed")).toBeVisible();
      await row.locator('select[name="jurisdictionIds"]').selectOption(jurisdiction.id);
      await row.getByRole("button", { name: "Confirm address areas" }).click();
      // Successful verification removes the row from the REVIEW filter;
      // assert persisted state and its appearance in the verified list,
      // rather than looking for a transient success label on a removed row.
      await expect.poll(async () => (await prisma.addressTaxLocation.findFirst({
        where: { serviceAddressId: address.id, isCurrent: true },
      }))?.status).toBe("VERIFIED");
      await page.goto("/desk/sales-tax/areas?status=VERIFIED");
      await expect(page.getByRole("listitem").filter({ hasText: address.line1 })).toBeVisible();
    } finally {
      await prisma.addressTaxLocation.deleteMany({ where: { serviceAddressId: address.id } });
      await prisma.serviceAddress.delete({ where: { id: address.id } });
      await prisma.taxJurisdiction.delete({ where: { id: jurisdiction.id } });
    }
  });
  test("areas and exemption pages meet accessible mobile light/dark baseline", async ({ page }) => {
    test.skip(!fs.existsSync(owner), "Authenticated owner fixture required");
    await page.setViewportSize({ width: 360, height: 780 });
    for (const url of ["/desk/sales-tax/areas", "/desk/sales-tax/exemptions"]) {
      await page.goto(url);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const report = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(report.violations, `${url} ${colorScheme}`).toEqual([]);
      }
    }
  });
});

test.describe("staff route isolation", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("staff may not view finance address/certificate lists", async ({ page }) => {
    test.skip(!fs.existsSync(staff), "Test-only staff authentication is required");
    await page.goto("/desk/sales-tax/areas");
    await expect(page).not.toHaveURL(/\/desk\/sales-tax\/areas(?:\?|$)/);
    await page.goto("/desk/sales-tax/exemptions");
    await expect(page).not.toHaveURL(/\/desk\/sales-tax\/exemptions(?:\?|$)/);
  });
});

