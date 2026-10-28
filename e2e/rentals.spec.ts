import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { scanAccessibilityRoute } from "./accessibility-route-helpers";
import { enabled, SIZES } from "./support/ar0b-fixtures";

// AR-4a (docs/build-specs/screens/RENTALS.md section 7): the rentals list
// and record in a real browser.
const owner = "e2e/.auth/owner.json";
const staff = "e2e/.auth/staff.json";

type RentalFixture = {
  name: string;
  customerId: string;
  agreementId: string;
  cleanup(): Promise<void>;
};

async function makeRental(
  label: string,
  status: "DRAFT" | "SCHEDULED" | "ACTIVE",
  opts: { signed?: boolean } = {},
): Promise<RentalFixture> {
  const { prisma } = await import("../src/lib/prisma");
  const tag = randomUUID().replaceAll("-", "").slice(0, 12);
  const name = `${label} ${tag}`;
  const userId = `ar4a-u-${tag}`;
  const customerId = `ar4a-c-${tag}`;
  await prisma.user.create({
    data: { id: userId, email: `ar4a-${tag}@example.test`, name, role: "CUSTOMER" },
  });
  await prisma.customer.create({
    data: { id: customerId, userId, referralCode: `AR4A${tag}`, phone: "970-555-0142" },
  });
  const address = await prisma.serviceAddress.create({
    data: { customerId, line1: "1402 10th Ave", city: "Greeley", zip: "80631" },
  });
  const agreement = await prisma.rentalAgreement.create({
    data: {
      customerId,
      serviceAddressId: address.id,
      status,
      depositCents: 0,
      lines: {
        create: [{ label: "Washer/Dryer set", monthlyPriceCents: 6500, listPriceCents: 6500 }],
      },
    },
  });
  if (opts.signed) {
    await prisma.signatureRecord.create({
      data: {
        agreementId: agreement.id,
        provider: "signwell",
        signedAt: new Date(),
        signerName: name,
        signerEmail: `ar4a-${tag}@example.test`,
      },
    });
  }
  return {
    name,
    customerId,
    agreementId: agreement.id,
    async cleanup() {
      await prisma.auditLog.deleteMany({ where: { entityId: agreement.id } });
      await prisma.job.deleteMany({ where: { agreementId: agreement.id } });
      await prisma.signatureRecord.deleteMany({ where: { agreementId: agreement.id } });
      await prisma.rentalAgreement.deleteMany({ where: { id: agreement.id } });
      await prisma.serviceAddress.deleteMany({ where: { customerId } });
      await prisma.customer.deleteMany({ where: { id: customerId } });
      await prisma.user.deleteMany({ where: { id: userId } });
    },
  };
}

test.describe("Rentals list and record", () => {
  test.use({ storageState: fs.existsSync(owner) ? owner : undefined });

  test("list tabs filter, and the old ?status=ACTIVE link still lands on Active", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const active = await makeRental("List Active", "ACTIVE");
    const draft = await makeRental("List Draft", "DRAFT");
    try {
      // Assertions scope to the desktop table: the kit table also renders a
      // phone card list (hidden at desktop widths), and .first() would pick
      // that hidden copy and never become visible.
      const table = page.locator("table");
      await page.goto("/desk/agreements", { waitUntil: "load" });
      await expect(page.getByRole("heading", { level: 1, name: "Customers" })).toBeVisible();
      await expect(table.getByText(active.name)).toBeVisible();
      await expect(table.getByText(draft.name)).toHaveCount(0);
      await page.getByRole("link", { name: /^Drafts/ }).click();
      await expect(table.getByText(draft.name)).toBeVisible();
      await page.goto("/desk/agreements?status=ACTIVE", { waitUntil: "load" });
      await expect(table.getByText(active.name)).toBeVisible();
      await expect(table.getByText(draft.name)).toHaveCount(0);
    } finally {
      await active.cleanup();
      await draft.cleanup();
    }
  });

  test("record primary action follows the rental's state", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const draft = await makeRental("Primary Draft", "DRAFT");
    const signed = await makeRental("Primary Signed", "SCHEDULED", { signed: true });
    const active = await makeRental("Primary Active", "ACTIVE");
    try {
      await page.goto(`/desk/agreements/${draft.agreementId}`, { waitUntil: "load" });
      await expect(page.getByRole("link", { name: "Resume rental builder" }).first()).toBeVisible();
      await page.goto(`/desk/agreements/${signed.agreementId}`, { waitUntil: "load" });
      await expect(page.getByRole("link", { name: "Schedule delivery" }).first()).toBeVisible();
      await page.goto(`/desk/agreements/${active.agreementId}`, { waitUntil: "load" });
      await expect(page.getByRole("link", { name: "End this rental…" }).first()).toBeVisible();
      await expect(page.getByText("Monthly rent")).toBeVisible();
      await expect(page.getByText("$65.00").first()).toBeVisible();
    } finally {
      await draft.cleanup();
      await signed.cleanup();
      await active.cleanup();
    }
  });

  test("End it today asks for confirmation, then the rental is Ended", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const active = await makeRental("End Today", "ACTIVE");
    try {
      await page.goto(`/desk/agreements/${active.agreementId}`, { waitUntil: "load" });
      await page.getByRole("link", { name: "End this rental…" }).first().click();
      const sheet = page.getByRole("dialog", { name: "End this rental" });
      await expect(sheet).toBeVisible();
      await expect(page.getByRole("alertdialog")).toHaveCount(0);
      await sheet.getByRole("button", { name: /End it today/ }).click();
      await sheet.getByRole("button", { name: "End the rental" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText(`End ${active.name}'s rental today?`)).toBeVisible();
      await dialog.getByRole("button", { name: "End the rental" }).click();
      await expect(page.getByText("Ended").first()).toBeVisible();
    } finally {
      await active.cleanup();
    }
  });

  test("accessibility at five sizes, light and dark", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(owner), "Disposable Postgres and a saved owner session required.");
    test.setTimeout(150_000);
    const fixture = await makeRental("Record Axe", "ACTIVE");
    try {
      await scanAccessibilityRoute(
        page,
        { path: "/desk/agreements/[id]", role: "OWNER", fixture: `/desk/agreements/${fixture.agreementId}` },
        SIZES,
      );
    } finally {
      await fixture.cleanup();
    }
  });
});

test.describe("Rental record for staff", () => {
  test.use({ storageState: fs.existsSync(staff) ? staff : undefined });

  test("staff keep the operational view and see no money", async ({ page }) => {
    test.skip(!enabled || !fs.existsSync(staff), "Disposable Postgres and a saved staff session required.");
    test.setTimeout(150_000);
    const fixture = await makeRental("Staff View", "ACTIVE");
    try {
      await page.goto(`/desk/agreements/${fixture.agreementId}`, { waitUntil: "load" });
      await expect(page.getByRole("heading", { level: 1, name: `Rental for ${fixture.name}` })).toBeVisible();
      await expect(page.getByText("Monthly rent")).toHaveCount(0);
      await expect(page.getByText("$65.00")).toHaveCount(0);
      await expect(page.getByRole("link", { name: "End this rental…" })).toHaveCount(0);
    } finally {
      await fixture.cleanup();
    }
  });
});
