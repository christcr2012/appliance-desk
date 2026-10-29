import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, SIZES } from "./support/ar0b-fixtures";

// AR-4c / CU-1 (CUSTOMERS spec section 7): the Customers list in a real
// browser — segment tabs, search, the side panel, staff sees no money and
// no Owes tab, and the filtered CSV export downloads.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

type Fixture = { name: string; customerId: string; email: string; cleanup(): Promise<void> };

async function makeCustomer(
  label: string,
  opts: { active?: boolean; pastDueCents?: number } = {},
): Promise<Fixture> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const name = `${label} ${tag}`;
  const email = `cu1-${tag}@example.test`;
  const userId = `cu1-u-${tag}`;
  const customerId = `cu1-c-${tag}`;
  await prisma.user.create({ data: { id: userId, email, name, role: "CUSTOMER" } });
  await prisma.customer.create({
    data: {
      id: customerId,
      userId,
      referralCode: `CU1${tag}`,
      phone: "(970) 555-0161",
      phoneDigits: "9705550161",
    },
  });
  const address = await prisma.serviceAddress.create({
    data: { customerId, line1: "2211 8th Ave", city: "Greeley", zip: "80631" },
  });
  if (opts.active) {
    await prisma.rentalAgreement.create({
      data: {
        customerId,
        serviceAddressId: address.id,
        status: "ACTIVE",
        firstDeliveredOn: new Date(Date.now() - 40 * 86_400_000),
        depositCents: 0,
        lines: { create: [{ label: "Washer", monthlyPriceCents: 6000, listPriceCents: 6000 }] },
      },
    });
  }
  if (opts.pastDueCents) {
    await prisma.invoice.create({
      data: {
        customerId,
        status: "OPEN",
        amountDueCents: opts.pastDueCents,
        amountPaidCents: 0,
        dueDate: new Date(Date.now() - 3 * 86_400_000),
      },
    });
  }
  return {
    name,
    customerId,
    email,
    cleanup: async () => {
      await prisma.invoice.deleteMany({ where: { customerId } });
      await prisma.rentalAgreement.deleteMany({ where: { customerId } });
      await prisma.serviceAddress.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}

test.describe("CU-1 customers list as owner", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("tabs, search, side panel and the filtered CSV export", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const owing = await makeCustomer("Owing Olive", { active: true, pastDueCents: 12345 });
    const fresh = await makeCustomer("New Ned");
    try {
      await page.goto("/desk/customers?segment=owes");
      await expect(page.getByRole("link", { name: /Owes money/ })).toBeVisible();
      await expect(page.getByText(owing.name)).toBeVisible();
      await expect(page.getByText("Owes $123.45")).toBeVisible();

      // Search narrows to the fresh customer on the New tab.
      await page.goto(`/desk/customers?segment=new&q=${encodeURIComponent(fresh.name)}`);
      await expect(page.getByText(fresh.name)).toBeVisible();
      await expect(page.getByText(owing.name)).toHaveCount(0);

      // Row click opens the side panel with the record summary.
      await page.goto(`/desk/customers?segment=owes&q=${encodeURIComponent(owing.name)}`);
      await page.getByText(owing.name).first().click();
      await expect(page).toHaveURL(/open=/);
      await expect(page.getByText("Next step")).toBeVisible();
      await expect(page.getByRole("link", { name: /Open full page/ })).toBeVisible();

      // The header export downloads exactly the filtered set.
      await page.goto(`/desk/customers?segment=owes&q=${encodeURIComponent(owing.name)}`);
      const downloadPromise = page.waitForEvent("download");
      await page.getByRole("button", { name: /More actions|⋯|Overflow/ }).first().click();
      await page.getByRole("link", { name: "Export (CSV)" }).click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^customers-\d{4}-\d{2}-\d{2}\.csv$/);
      const path = await download.path();
      const csv = fs.readFileSync(path!, "utf8");
      expect(csv).toContain(owing.email);
      expect(csv).not.toContain(fresh.email);
    } finally {
      await owing.cleanup();
      await fresh.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const fixture = await makeCustomer("Axe Amy", { active: true });
    try {
      await scanAccessibilityRoute(
        page,
        { path: "/desk/customers", role: "OWNER", fixture: `/desk/customers?q=${encodeURIComponent(fixture.name)}` },
        SIZES,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});

test.describe("CU-1 customers list as staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });

  test("staff sees the list with no money and no Owes money tab", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    test.setTimeout(150_000);
    const fixture = await makeCustomer("Staff Sue", { active: true, pastDueCents: 12345 });
    try {
      await page.goto(`/desk/customers?q=${encodeURIComponent(fixture.name)}`);
      await expect(page.getByText(fixture.name)).toBeVisible();
      await expect(page.getByRole("link", { name: /Owes money/ })).toHaveCount(0);
      await expect(page.getByText("$123.45")).toHaveCount(0);
      await expect(page.getByText("$60.00")).toHaveCount(0);
      await expect(page.getByText("Monthly rent")).toHaveCount(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
