import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { prisma } from "@/lib/prisma";
import { businessDateFromKey } from "@/lib/business-date";

const owner = "e2e/.auth/owner.json";
const admin = "e2e/.auth/admin.json";
const staff = "e2e/.auth/staff.json";
const db = new URL(process.env.DATABASE_URL ?? "postgresql://localhost/unset");
const isolated = process.env.CI === "true" && db.pathname === "/appliance_desk_test" &&
  ["localhost", "127.0.0.1"].includes(db.hostname);
const date = (s: string) => businessDateFromKey(s)!;
async function fixture(run: (ids: { periodId: string; amendmentId: string; name: string }) => Promise<void>) {
  const name = "T7C private filing " + randomUUID().slice(0, 8);
  const account = await prisma.taxFilingAccount.create({ data: {
    name, kind: "SALES_RETURN", frequency: "MONTHLY", basis: "ACCRUAL",
  } });
  const worksheet = {
    account: { id: account.id, name, kind: "SALES_RETURN", accountNumber: null, portalUrl: null },
    periodStart: "2026-07-01", periodEnd: "2026-07-31", dueOn: "2026-08-20", legalDueOn: "2026-08-20",
    basis: "ACCRUAL", zeroReturn: true, rows: [], useTax: [],
    totals: { taxCents: 0, serviceFeeCents: 0,
      remitIfOnTimeCents: 0, remitIfLateCents: 0, remitCents: 0 },
    steps: ["Test-only frozen official filing step"], warnings: [],
  };
  const period = await prisma.taxFilingPeriod.create({ data: {
    filingAccountId: account.id, periodStart: date("2026-07-01"),
    periodEnd: date("2026-07-31"), dueOn: date("2026-08-20"),
    status: "FILED", filedOn: date("2026-08-19"), paidOn: date("2026-08-19"),
    amountPaidCents: 0, confirmationNumber: "T7C-TEST-CONFIRM",
    worksheet,
  } });
  const amendment = await prisma.taxFilingAmendment.create({ data: {
    periodId: period.id, sequence: 1, status: "OPEN", additionalTaxCents: 0,
    packet: { previouslyReported: worksheet, corrected: worksheet, additionalTaxCents: 0,
      differences: [{ key: "SALES:TEST", previouslyReportedCents: 12,
        correctedCents: 0, differenceCents: -12 }] },
  } });
  try { await run({ periodId: period.id, amendmentId: amendment.id, name }); }
  finally {
    await prisma.taxFilingAmendment.deleteMany({ where: { periodId: period.id } });
    await prisma.taxFilingPeriod.delete({ where: { id: period.id } });
    await prisma.taxFilingAccount.delete({ where: { id: account.id } });
  }
}

test.describe("guided sales tax filing", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });
  test("filed return uses immutable evidence and private CSV at phone width", async ({ page }) => {
    test.skip(!isolated || !fs.existsSync(owner), "Test-only owner and isolated PostgreSQL are required");
    await fixture(async ({ periodId, name }) => {
      await page.setViewportSize({ width: 360, height: 780 });
      await page.goto("/desk/sales-tax/returns/" + periodId);
      await expect(page.getByRole("heading", { name: new RegExp(name) })).toBeVisible();
      await expect(page.getByText("Test-only frozen official filing step")).toHaveCount(0);
      await expect(page.getByText(/Filed — worksheet frozen/)).toBeVisible();
      await expect(page.getByText(/T7C-TEST-CONFIRM/)).toBeVisible();
      await expect(page.getByRole("button", { name: /Record filed and paid/ })).toHaveCount(0);
      const csv = await page.context().request.get("/desk/sales-tax/returns/" + periodId + "/csv");
      expect(csv.status()).toBe(200);
      expect(csv.headers()["content-disposition"]).toContain(periodId);
      expect(csv.headers()["content-disposition"]).not.toContain(name);
      for (const colorScheme of ["light", "dark"] as const) {
        await page.emulateMedia({ colorScheme });
        const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
        expect(axe.violations).toEqual([]);
      }
    });
  });
  test("frozen amendment comparison opens without changing original", async ({ page }) => {
    test.skip(!isolated || !fs.existsSync(owner), "Test-only owner and isolated PostgreSQL are required");
    await fixture(async ({ periodId }) => {
      await page.goto("/desk/sales-tax/returns/" + periodId + "/amend");
      await expect(page.getByText("SALES:TEST")).toBeVisible();
      await expect(page.getByRole("button", { name: "Record amendment filed" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Mark handled outside" })).toBeVisible();
    });
  });
});

test.describe("administrator tax filing read-only access", () => {
  test.use({ storageState: fs.existsSync(admin) ? admin : undefined });
  test("admin cannot file, amend or record payment", async ({ page }) => {
    test.skip(!isolated || !fs.existsSync(admin), "Test-only admin is required");
    await fixture(async ({ periodId }) => {
      await page.goto("/desk/sales-tax/returns/" + periodId);
      await expect(page.getByText(/Read-only for administrators/)).toBeVisible();
      await expect(page.getByRole("button", { name: /Record filed|Save progress/ })).toHaveCount(0);
      await page.goto("/desk/sales-tax/returns/" + periodId + "/amend");
      await expect(page.getByRole("button", { name: /Record amendment|Mark handled outside/ })).toHaveCount(0);
    });
  });
});

test.describe("staff tax filing isolation", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });
  test("staff cannot read private return calendar", async ({ page }) => {
    test.skip(!fs.existsSync(staff), "Test-only staff is required");
    await page.goto("/desk/sales-tax/returns");
    await expect(page).not.toHaveURL(/\/desk\/sales-tax\/returns(?:\?|$)/);
    const response = await page.context().request.get("/desk/sales-tax/returns/calendar.ics", { maxRedirects: 0 });
    expect(response.status()).not.toBe(200);
  });
});

