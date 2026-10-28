import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, overdueCustomer, scanWithReport, SIZES } from "./support/ar0b-fixtures";

// AR-3 (docs/build-specs/screens/MONEY-AREA.md section 6): Money › Overview, Money › Payments and the
// redesigned bill record in a real browser.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

/** A customer with one open bill that has a Stripe payment page (the Take payment path). */
async function stripeBillCustomer(label: string) {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const name = `${label} ${tag}`;
  const userId = `ar3-u-${tag}`;
  const customerId = `ar3-c-${tag}`;
  await prisma.user.create({ data: { id: userId, email: `ar3-${tag}@example.test`, name, role: "CUSTOMER" } });
  await prisma.customer.create({ data: { id: customerId, userId, referralCode: `AR3${tag}` } });
  const bill = await prisma.invoice.create({
    data: { customerId, status: "OPEN", dueDate: new Date(Date.now() + 5 * 86_400_000), amountDueCents: 7000, stripeInvoiceId: `in_ar3_${tag}` },
  });
  return {
    name,
    customerId,
    billId: bill.id,
    billNumber: bill.invoiceNumber,
    async cleanup() {
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}

test.describe("Money area", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("overview shows the four numbers and both sections", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    await page.goto("/desk/money", { waitUntil: "load" });
    await expect(page.getByRole("heading", { name: "Money", exact: true })).toBeVisible();
    for (const label of ["Money in this month", "Still owed", "Past due", "Coming in 30 days"]) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: "Needs a decision" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recent payments" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("payments: tabs work and the old billing views redirect here", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    await page.goto("/desk/billing?view=deposits", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/desk\/payments\?status=deposits$/);
    await expect(page.getByRole("link", { name: /^Deposits/ })).toHaveAttribute("aria-current", "page");
    await page.goto("/desk/billing?view=waiting", { waitUntil: "load" });
    await expect(page).toHaveURL(/\/desk\/payments\?status=waiting$/);
    await page.goto("/desk/payments", { waitUntil: "load" });
    await expect(page.getByRole("link", { name: /^Received/ })).toHaveAttribute("aria-current", "page");
    await expect(page.getByPlaceholder("Name or bill number")).toBeVisible();
  });

  test("bill record: record cash or check through the sheet pays the bill; then Print is primary", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    const fixture = await overdueCustomer("Money Area Record");
    try {
      await page.goto(`/desk/billing/customer/${fixture.customerId}/invoice/${fixture.billId}`, { waitUntil: "load" });
      await expect(page.getByRole("button", { name: "Record cash or check" })).toBeVisible();
      await page.getByRole("button", { name: "Record cash or check" }).click();
      const sheet = page.getByRole("dialog", { name: "Record cash or check" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByText(`For bill #${fixture.billNumber}`)).toBeVisible();
      await sheet.getByLabel("Amount ($)").fill("70");
      await sheet.getByRole("button", { name: "Record payment", exact: true }).click();
      await expect(page.getByText("Recorded $70.00")).toBeVisible();
      await expect(page.getByText("Still owed")).toBeVisible();
      await expect(page.locator("dd", { hasText: "$0.00" }).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Print", exact: true })).toBeVisible();
    } finally {
      // The shared fixture cleanup does not know about payments/receipts; remove them first.
      const { prisma } = await import("../src/lib/prisma");
      await prisma.payment.deleteMany({ where: { invoice: { customerId: fixture.customerId } } });
      await prisma.receipt.deleteMany({ where: { customerId: fixture.customerId } });
      await fixture.cleanup();
    }
  });

  test("take payment sheet opens in place from the bill record and from the Bills list", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(120_000);
    const fixture = await stripeBillCustomer("Money Area Stripe");
    try {
      await page.goto(`/desk/billing/customer/${fixture.customerId}/invoice/${fixture.billId}`, { waitUntil: "load" });
      await page.getByRole("button", { name: "Take payment", exact: true }).click();
      const sheet = page.getByRole("dialog", { name: "Take payment · $70.00" });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole("heading", { name: "Ask for payment" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/desk/billing?q=${encodeURIComponent(fixture.name)}`, { waitUntil: "load" });
      const card = page.getByRole("list", { name: "Bills" }).getByRole("listitem").first();
      await expect(card).toContainText(fixture.name);
      await card.getByRole("button", { name: "Take payment", exact: true }).click();
      await expect(page.getByRole("dialog", { name: "Take payment · $70.00" })).toBeVisible();
      await expect(page).toHaveURL(/\/desk\/billing\?/);
    } finally {
      await fixture.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(180_000);
    await scanWithReport(page, () => scanAccessibilityRoute(page, { path: "/desk/money", role: "OWNER", fixture: "/desk/money" }, SIZES));
    await scanWithReport(page, () => scanAccessibilityRoute(page, { path: "/desk/payments", role: "OWNER", fixture: "/desk/payments" }, SIZES));
    const fixture = await overdueCustomer("Money Area Scan");
    try {
      const record = `/desk/billing/customer/${fixture.customerId}/invoice/${fixture.billId}`;
      await scanWithReport(page, () => scanAccessibilityRoute(page, { path: "/desk/billing/customer/[id]/invoice/[invoiceId]", role: "OWNER", fixture: record }, SIZES));
    } finally {
      await fixture.cleanup();
    }
  });
});

test.describe("Money area for staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });

  test("staff are refused the money pages", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    await page.goto("/desk/money");
    await expect(page).toHaveURL(/\/$/);
    await page.goto("/desk/payments");
    await expect(page).toHaveURL(/\/$/);
  });
});
